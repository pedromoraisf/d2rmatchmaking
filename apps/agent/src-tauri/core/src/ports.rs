//! The ports every core rule reaches the outside world through (design.md § Ports). The app crate supplies the Windows
//! adapters; tests supply the fakes defined here (`PausedWallClock`, `SequentialIds`) and in `core/tests/support`.

use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use uuid::Uuid;

use crate::secret::Secret;
use crate::view::AgentView;

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

/// A rectangle of an image, in pixels, with its origin at the top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// An RGBA image in memory. The pixels never leave the process (AGS-20).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Text read from a region, with the reader's confidence.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadText {
    pub text: String,
    pub confidence: f64,
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
    use chrono::{DateTime, TimeDelta, Utc};

    use super::{PausedWallClock, WallClock};

    #[tokio::test(start_paused = true)]
    async fn wall_clock_follows_paused_time() {
        let start: DateTime<Utc> = "2026-10-31T10:00:00Z".parse().expect("a valid instant");
        let clock = PausedWallClock::starting_at(start);

        assert_eq!(clock.now_utc(), start);
        tokio::time::advance(std::time::Duration::from_secs(5)).await;
        assert_eq!(clock.now_utc(), start + TimeDelta::seconds(5));
    }
}
