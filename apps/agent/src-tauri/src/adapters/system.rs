//! The system clock and the observation id generator (design.md § Ports): wall time from the OS and random v4 ids for the
//! idempotency keys (AD-051). Both are pure reads of the machine; neither touches the game.

use chrono::{DateTime, Utc};
use d2rmm_agent_core::ports::{IdGenerator, WallClock};
use uuid::Uuid;

/// The wall clock of the machine. Deadlines use the monotonic clock in core; this only stamps `capturedAt` and code expiry.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl WallClock for SystemClock {
    fn now_utc(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Random v4 ids for the idempotency keys of observations.
#[derive(Debug, Default, Clone, Copy)]
pub struct RandomIds;

impl IdGenerator for RandomIds {
    fn idempotency_key(&self) -> Uuid {
        Uuid::new_v4()
    }
}
