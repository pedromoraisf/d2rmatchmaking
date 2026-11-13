//! The ports every core rule reaches the outside world through (design.md § Ports). The app crate supplies the Windows
//! adapters; tests supply the fakes defined here (`PausedWallClock`, `SequentialIds`) and in `core/tests/support`.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use d2rmm_agent_domain::characters::Card;
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};
use uuid::Uuid;

use crate::messages::{
    FrameReading, GameNameObservation, IssuedCode, Presence, ReadyCheckEnd, ReadyCheckOpen,
};
use crate::secret::Secret;
use crate::view::AgentView;

/// Why an agent request did not yield its answer. The variants carry no response body, header, URL or token, so the
/// messages and `Debug` output never leak one (AGS-09, NFR-06).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ApiError {
    #[error("the API rejected the token")]
    Unauthorized,
    #[error("the API requires a newer agent")]
    UpgradeRequired,
    #[error("the API asked to slow down")]
    RateLimited { retry_after: Option<Duration> },
    #[error("the claim code is gone")]
    Gone,
    #[error("the pairing is still pending")]
    Pending,
    #[error("the API failed")]
    Server,
    #[error("the API could not be reached")]
    Network,
    #[error("the API answered with something the contract does not allow")]
    Invalid,
    /// The API answered 404 or 409 to an answer to a ready check: the check ended, or the answer was already given (RDY-06).
    #[error("the ready check is no longer open")]
    CheckEnded,
}

/// The credential store refused a write. It carries no detail, so it never leaks the token (AGS-09).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the credential store refused the write")]
pub struct StoreError;

/// Holds the agent token in the OS credential store and nowhere else (AGS-06, AGS-09).
pub trait TokenStore {
    fn load(&self) -> Option<Secret>;
    fn save(&self, token: &Secret) -> Result<(), StoreError>;
    fn delete(&self);
}

/// Names of the processes in the current process snapshot. Names only; no handles (AD-055).
pub trait ProcessSource {
    fn names(&self) -> Vec<String>;
}

/// An RGBA image in memory. The pixels never leave the process (AGS-20).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ReadError {
    #[error("the OCR engine is not available")]
    EngineUnavailable,
    #[error("the text could not be read")]
    Failed,
}

/// Reads the text of a region on this machine (AGS-20).
pub trait TextReader {
    fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError>;

    /// Several readings of the region, each the engine's text for the same pixels read in another way (another scale or
    /// filter), the first being `read`'s. The screen readers combine them: the engine's text is noisy and the variants err
    /// differently. A reader with one way to read returns its one reading; a failed region returns none.
    fn read_variants(&self, image: &Rgba, region: Region) -> Vec<ReadText> {
        self.read(image, region).into_iter().collect()
    }

    /// The lines of text in the region with where each sits in the frame, top to bottom. The screen readers find a card, a
    /// popup option or the Party panel's field by the text of a line, not by a fixed offset. A reader that does not know
    /// where its lines sit returns the lines of `read` with the region cut into equal rows, one per line.
    fn read_lines(&self, image: &Rgba, region: Region) -> Vec<TextLine> {
        let Ok(read) = self.read(image, region) else {
            return Vec::new();
        };
        let lines: Vec<&str> = read
            .text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        let count = u32::try_from(lines.len()).unwrap_or(u32::MAX).max(1);
        let row = (region.height / count).max(1);
        lines
            .into_iter()
            .zip(0u32..)
            .map(|(text, index)| TextLine {
                text: text.to_string(),
                region: Region {
                    x: region.x,
                    y: region.y + row * index,
                    width: region.width,
                    height: row,
                },
            })
            .collect()
    }
}

/// Captures the client area of the D2R game window in memory (CHR-03). `None` when no game window is found or it is
/// minimized. Only the app crate's window adapter implements it.
pub trait FrameSource {
    fn capture(&self) -> Option<Rgba>;
}

/// Whether the player consented to screen capture, kept on this PC (CHR-01, CHR-02). The store holds no secret.
pub trait ConsentStore {
    fn load(&self) -> bool;
    fn save(&self, consent: bool) -> Result<(), StoreError>;
}

/// Reads the screen a frame shows and, on the character selection screen, every complete card on it (CHR-04, CHR-06).
/// A card with any field it could not read is left out. The reader holds no state between frames.
pub trait FrameReader {
    fn read(&self, frame: &Rgba) -> FrameReading;
}

/// Why an update check did not install a version (AGS-26).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateFailure {
    Signature,
    Download,
    Manifest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateOutcome {
    Installed,
    UpToDate,
    Failed(UpdateFailure),
}

/// Checks the latest release and installs a newer version when its signature verifies (AGS-24, AGS-25).
pub trait UpdateChecker {
    fn check(&self) -> impl Future<Output = UpdateOutcome> + Send;
}

/// The API as the agent's use cases see it: the calls the agent makes, in message types. The adapters translate to and
/// from the contract (ADR 027, rule 3); no HTTP type or contract type crosses this port.
pub trait ApiGateway {
    fn request_code(&self) -> impl Future<Output = Result<IssuedCode, ApiError>> + Send;
    fn claim(&self, claim_secret: &Secret)
    -> impl Future<Output = Result<Secret, ApiError>> + Send;
    fn heartbeat(
        &self,
        token: &Secret,
        presence: &Presence,
        version: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;
    fn assignment(
        &self,
        token: &Secret,
    ) -> impl Future<Output = Result<Option<Assignment>, ApiError>> + Send;
    fn post_observation(
        &self,
        token: &Secret,
        observation: &GameNameObservation,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;
    /// Sends the complete cards of one character selection screen, 1 to 24 of them (CHR-09).
    fn post_characters(
        &self,
        token: &Secret,
        cards: &[Card],
    ) -> impl Future<Output = Result<(), ApiError>> + Send;
    /// Opens the room stream, resuming after `last_event_id` when the caller has one.
    fn open_stream(
        &self,
        token: &Secret,
        last_event_id: Option<&str>,
    ) -> impl Future<Output = Result<Box<dyn EventStream>, ApiError>> + Send;
    /// Accepts the ready check `check_id` for the token's account (RDY-02, RDY-07). The agent sends nothing else.
    fn accept_ready_check(
        &self,
        token: &Secret,
        check_id: &str,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;
    /// The account's open ready check, or `None` when it is in none (RDY-11). Read on every stream connection.
    fn my_ready_check(
        &self,
        token: &Secret,
    ) -> impl Future<Output = Result<Option<ReadyCheckOpen>, ApiError>> + Send;
}

/// One item of the room stream: an assignment, a ready check that opened or ended, or the end of the stream and why it
/// ended.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamItem {
    RoomAssigned(Assignment),
    ReadyCheckStarted(ReadyCheckOpen),
    ReadyCheckResolved(ReadyCheckEnd),
    Ended(EndReason),
}

/// Why a stream ended. The loop reconnects after every end; the reason only shapes what the loop shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndReason {
    /// The server closed the stream.
    Closed,
    /// No bytes arrived for the idle timeout.
    Idle,
    /// The stream failed, or broke the size bound, with this error.
    Failed(ApiError),
}

/// The room stream, one item at a time. The trait is object safe: `next` returns a boxed future, as `Updater` does for
/// `UpdateChecker`, so `ApiGateway::open_stream` can return `Box<dyn EventStream>`.
pub trait EventStream: Send {
    /// The next item. Cancel-safe: every piece of parser state lives in `self`, so a dropped future loses nothing.
    fn next(&mut self) -> Pin<Box<dyn Future<Output = StreamItem> + Send + '_>>;
    /// The id of the last event the stream dispatched, to resume from after a reconnect.
    fn last_event_id(&self) -> Option<&str>;
}

/// Makes the idempotency keys of observations (AD-051).
pub trait IdGenerator {
    fn idempotency_key(&self) -> Uuid;
}

/// The wall clock. Every deadline uses the monotonic clock; wall time only stamps `capturedAt` and code expiry.
pub trait WallClock {
    fn now_utc(&self) -> DateTime<Utc>;
}

/// Receives every state change of the agent window (AGS-34).
pub trait StateSink {
    fn publish(&self, view: AgentView);
}

/// A wall clock that moves with `tokio::time`: under `start_paused`, `tokio::time::advance` moves it too.
#[derive(Debug)]
pub struct PausedWallClock {
    anchor: tokio::time::Instant,
    start: DateTime<Utc>,
}

impl PausedWallClock {
    /// Starts the clock at `start` and reads `tokio::time::Instant::now()` as its anchor.
    pub fn starting_at(start: DateTime<Utc>) -> Self {
        Self {
            anchor: tokio::time::Instant::now(),
            start,
        }
    }
}

impl WallClock for PausedWallClock {
    fn now_utc(&self) -> DateTime<Utc> {
        let elapsed: Duration = tokio::time::Instant::now().duration_since(self.anchor);
        self.start + TimeDelta::from_std(elapsed).expect("elapsed test time fits a TimeDelta")
    }
}

/// Idempotency keys `00000000-…-000000000001`, `…2`, … in call order, for deterministic tests.
#[derive(Debug)]
pub struct SequentialIds {
    next: AtomicU64,
}

impl SequentialIds {
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
        }
    }
}

impl Default for SequentialIds {
    fn default() -> Self {
        Self::new()
    }
}

impl IdGenerator for SequentialIds {
    fn idempotency_key(&self) -> Uuid {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        Uuid::from_u128(u128::from(n))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use chrono::{DateTime, TimeDelta, Utc};

    use super::{ApiError, PausedWallClock, WallClock};

    #[test]
    fn api_error_debug_never_contains_a_secret_or_url() {
        let every_variant = [
            ApiError::Unauthorized,
            ApiError::UpgradeRequired,
            ApiError::RateLimited {
                retry_after: Some(Duration::from_secs(60)),
            },
            ApiError::RateLimited { retry_after: None },
            ApiError::Gone,
            ApiError::Pending,
            ApiError::Server,
            ApiError::Network,
            ApiError::Invalid,
            ApiError::CheckEnded,
        ];
        for error in every_variant {
            let shown = format!("{error:?} {error}");
            for leaked in ["d2rmm_", "Bearer", "://", "claim-secret"] {
                assert!(!shown.contains(leaked), "{shown:?} shows {leaked:?}");
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn wall_clock_follows_paused_time() {
        let start: DateTime<Utc> = "2026-10-31T10:00:00Z".parse().expect("a valid instant");
        let clock = PausedWallClock::starting_at(start);

        assert_eq!(clock.now_utc(), start);
        tokio::time::advance(std::time::Duration::from_secs(5)).await;
        assert_eq!(clock.now_utc(), start + TimeDelta::seconds(5));
    }
}

#[cfg(test)]
mod read_lines_tests {
    use d2rmm_agent_domain::vision::{ReadText, Region};

    use super::{ReadError, Rgba, TextReader};

    struct Fixed(&'static str);

    impl TextReader for Fixed {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: self.0.to_string(),
                confidence: 1.0,
            })
        }
    }

    const REGION: Region = Region {
        x: 100,
        y: 200,
        width: 300,
        height: 90,
    };

    fn frame() -> Rgba {
        Rgba {
            width: 1,
            height: 1,
            pixels: Vec::new(),
        }
    }

    #[test]
    fn the_default_cuts_the_region_into_one_row_per_non_blank_line() {
        let lines =
            Fixed("Matriarch\n\n vukVuka \nLevel 88 Sorceress").read_lines(&frame(), REGION);
        let texts: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();
        assert_eq!(texts, ["Matriarch", "vukVuka", "Level 88 Sorceress"]);
        let rows: Vec<(u32, u32)> = lines
            .iter()
            .map(|line| (line.region.y, line.region.height))
            .collect();
        assert_eq!(rows, [(200, 30), (230, 30), (260, 30)]);
        assert!(
            lines
                .iter()
                .all(|line| line.region.x == 100 && line.region.width == 300)
        );
    }

    #[test]
    fn the_default_of_a_blank_or_failed_read_has_no_lines() {
        assert!(Fixed("  \n ").read_lines(&frame(), REGION).is_empty());
        struct Broken;
        impl TextReader for Broken {
            fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
                Err(ReadError::Failed)
            }
        }
        assert!(Broken.read_lines(&frame(), REGION).is_empty());
    }
}
