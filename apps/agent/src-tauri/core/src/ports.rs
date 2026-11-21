//! The ports every core rule reaches the outside world through (design.md § Ports). The app crate supplies the Windows
//! adapters; tests supply the fakes defined here (`PausedWallClock`, `SequentialIds`) and in `core/tests/support`.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use d2rmm_agent_domain::capture_cascade::{CaptureMethod, CascadeParams};
use d2rmm_agent_domain::characters::Card;
use d2rmm_agent_domain::frame_content::FrameContent;
use d2rmm_agent_domain::remote_config::{Effective, Wire};
use d2rmm_agent_domain::room_assignment::{Assignment, RoomId};
use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};
use uuid::Uuid;

use crate::messages::{
    FrameReading, GameNameObservation, IssuedCode, PlayerObservation, Presence, ReadyCheckEnd,
    ReadyCheckOpen,
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
    /// popup option or the Party panel's field by the text of a line, not by a fixed offset. The default is for fakes and
    /// readers without line geometry: it cuts the region into equal rows, one per non-blank line of `read`, so the rows are
    /// not where the lines really sit. A real reader overrides it with the boxes the engine returns.
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

    /// The lines of the region as each variant reads them (the ways `read_variants` reads the region), the first being
    /// `read_lines`'. The engine's lines are noisy and the variants err differently, so the screen readers take an anchor
    /// found in any of them. A reader with one way to read returns one set.
    fn read_line_variants(&self, image: &Rgba, region: Region) -> Vec<Vec<TextLine>> {
        vec![self.read_lines(image, region)]
    }
}

/// Captures the client area of the D2R game window in memory (CHR-03). `None` when no game window is found or it is
/// minimized. Only the app crate's window adapter implements it.
pub trait FrameSource {
    fn capture(&self) -> Option<Rgba>;

    /// The size of the whole game window, title bar and borders included, for the diagnostics. `None` when the platform
    /// cannot say it; the client area is the frame itself.
    fn window_size(&self) -> Option<(u32, u32)> {
        None
    }

    /// What the capture is doing, for the window and the heartbeat (CAP-07). A source with one fixed way to capture has
    /// nothing to say: no method, a read rate of 0.
    fn status(&self) -> CaptureStatus {
        CaptureStatus::default()
    }

    /// Ends every capture session the source holds, when the player withdrew consent or the game is gone (CAP-05, CAP-09).
    /// Idempotent; a source that holds none does nothing.
    fn release(&self) {}

    /// Hands the source the cascade's numbers before a look (RCF-08). A source with one fixed way to capture has no cascade.
    fn configure(&self, _params: CascadeParams) {}
}

/// What a frame source says about its capture (CAP-07): the method that gave the last usable frame, the share of the last
/// looks that gave one, and whether the last look it was asked for gave none. Numbers and fixed words only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CaptureStatus {
    /// The method of the last usable frame; `None` before one, or after a look that gave none.
    pub method: Option<CaptureMethod>,
    /// The usable share of the last looks, a whole percent.
    pub read_rate_percent: u8,
    /// The last look was asked for and no method gave a usable frame (CAP-02).
    pub unusable: bool,
    /// What the usable frame of the last look holds, when the source already measured it: the loop does not measure it again.
    pub content: Option<FrameContent>,
}

/// Why a method gave no frame. A game window that is not there (closed, minimized) is not a failure of the method, and does
/// not move the cascade (CAP-05).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Miss {
    /// No game window with a client area: nothing was captured.
    NoWindow,
    /// The window is there and the method returned no frame.
    Failed,
}

/// The ways to capture the game window the PC offers, one capture at a time (capture-cascade, design § Ports). Every method
/// returns the client area of the game window and nothing else (CAP-04); the `Capturer` decides which one to ask.
pub trait MethodSource {
    /// The methods this PC can offer, in any order; the cascade orders them.
    fn methods(&self) -> Vec<CaptureMethod>;

    /// One capture with `method`: the client area as a frame, or why there is none.
    fn capture_with(&self, method: CaptureMethod) -> Result<Rgba, Miss>;

    /// The size of the game's client area now, when the platform can say it. A frame of another size is refused (CAP-04).
    fn client_size(&self) -> Option<(u32, u32)> {
        None
    }

    /// The size of the whole game window, for the diagnostics.
    fn window_size(&self) -> Option<(u32, u32)> {
        None
    }

    /// Ends every capture session of every method (CAP-09). Idempotent.
    fn release(&self) {}
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

    /// `read` under the configuration the agent runs now (RCF-08): the reader takes the values it uses at this look. A reader
    /// that uses none reads as `read` does.
    fn read_with(&self, frame: &Rgba, _config: &Effective) -> FrameReading {
        self.read(frame)
    }
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
    /// Posts one chat sighting (a player joined or left) to its room, once: the caller never retries it (server-name-match).
    fn post_player_observation(
        &self,
        token: &Secret,
        observation: &PlayerObservation,
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

/// Why a room ended: the stage the API moved it to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomEndReason {
    Expired,
    Closed,
}

impl RoomEndReason {
    /// The reason as the span event records it (ARL-07).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Expired => "expired",
            Self::Closed => "closed",
        }
    }
}

/// A room that expired or closed, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomEnd {
    pub room: RoomId,
    pub reason: RoomEndReason,
}

/// One item of the room stream: an assignment, a ready check that opened or ended, or the end of the stream and why it
/// ended.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamItem {
    RoomAssigned(Assignment),
    ReadyCheckStarted(ReadyCheckOpen),
    ReadyCheckResolved(ReadyCheckEnd),
    /// The room with this id expired or closed (LBR-05): an assignment held for it is dropped.
    RoomEnded(RoomEnd),
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
    fn the_default_line_variants_are_the_one_set_of_read_lines() {
        let reader = Fixed("Matriarch\nvukVuka");
        assert_eq!(
            reader.read_line_variants(&frame(), REGION),
            vec![reader.read_lines(&frame(), REGION)]
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

/// What one request for the remote configuration came to (remote-config RCF-04). The body is bytes: the core never reads JSON,
/// the `ConfigReader` port does, and `from_wire` decides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fetched {
    /// A `200`: the body and the `ETag` the API gave it.
    Body {
        bytes: Vec<u8>,
        etag: Option<String>,
    },
    /// A `304`: the API still serves what the agent holds.
    NotModified,
    /// A `404`: the API serves no configuration, so the agent keeps what it holds (the built-in defaults with none).
    Absent,
    /// The request failed.
    Failed(ApiError),
}

/// The API's configuration route, on the agent's own API base only (RCF-04, ADR 010). The request carries the token, the agent
/// version and the tag of what the agent holds; nothing else.
pub trait ConfigGateway {
    fn fetch_config(
        &self,
        token: &Secret,
        held_etag: Option<&str>,
    ) -> impl Future<Output = Fetched> + Send;
}

/// Keeps the last good body on the PC (RCF-06): written whole or not at all, read back through the same rules as a fetched body.
pub trait ConfigStore {
    /// The stored body, or `None` when there is none.
    fn load(&self) -> Option<Vec<u8>>;
    fn save(&self, body: &[u8]) -> Result<(), StoreError>;
    /// Removes a stored body that failed its rules.
    fn delete(&self);
}

/// Reads a body into the closed set of fields the agent knows (RCF-02, RCF-10): `None` when it is not a JSON object or is over
/// the size limit. Unknown fields are not carried.
pub trait ConfigReader {
    fn read(&self, body: &[u8]) -> Option<Wire>;
}
