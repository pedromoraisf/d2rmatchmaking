//! The observation retry policy (AHM-10, AHM-15; AD-051). A lost network or a 5xx is retried with the same key at 1, 2, 4
//! and 8 s, five attempts in all. Any other failure drops the observation at once. A 401 or a 426 that moves the retry
//! epoch while the observation sleeps drops it too. The policy reads no clock: the core loop does the waiting.

use std::time::Duration;

use crate::timings::OBSERVATION_RETRY_DELAYS;

/// How a failed post is classified. The application maps its port error to this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostFailure {
    /// A lost network or a 5xx: the same observation is posted again after a wait.
    Transient,
    /// Any other answer: the observation is dropped at once.
    Permanent,
}

/// What follows a failed attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    /// Sleep this long, then post again.
    For(Duration),
    /// Drop the observation.
    Drop,
}

/// What follows a sleep between two attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retry {
    /// Post again.
    Again,
    /// Drop the observation: the retry epoch moved while it slept.
    Drop,
}

/// The retry state of one observation: the epoch it started under and the failures so far.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationRetry {
    epoch: u64,
    failures: usize,
}

impl ObservationRetry {
    /// Starts the retries of an observation posted under retry epoch `epoch`.
    pub fn new(epoch: u64) -> Self {
        Self { epoch, failures: 0 }
    }

    /// Applies one failed attempt. The fifth failed attempt drops the observation.
    pub fn after_failure(&mut self, failure: PostFailure) -> Wait {
        if failure == PostFailure::Permanent {
            return Wait::Drop;
        }
        let Some(delay) = OBSERVATION_RETRY_DELAYS.get(self.failures) else {
            return Wait::Drop;
        };
        self.failures += 1;
        Wait::For(*delay)
    }

    /// Applies the epoch check after a sleep: a 401 or 426 that moved the epoch drops the observation.
    pub fn after_sleep(&self, current_epoch: u64) -> Retry {
        if current_epoch == self.epoch {
            Retry::Again
        } else {
            Retry::Drop
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{ObservationRetry, PostFailure, Retry, Wait};

    #[test]
    fn observation_retry_delays_one_two_four_eight_then_drop() {
        let mut retry = ObservationRetry::new(0);
        assert_eq!(
            retry.after_failure(PostFailure::Transient),
            Wait::For(Duration::from_secs(1))
        );
        assert_eq!(
            retry.after_failure(PostFailure::Transient),
            Wait::For(Duration::from_secs(2))
        );
        assert_eq!(
            retry.after_failure(PostFailure::Transient),
            Wait::For(Duration::from_secs(4))
        );
        assert_eq!(
            retry.after_failure(PostFailure::Transient),
            Wait::For(Duration::from_secs(8))
        );
        assert_eq!(retry.after_failure(PostFailure::Transient), Wait::Drop);
    }

    #[test]
    fn non_retryable_failure_drops() {
        let mut retry = ObservationRetry::new(0);
        assert_eq!(retry.after_failure(PostFailure::Permanent), Wait::Drop);
    }

    #[test]
    fn epoch_moved_during_sleep_drops() {
        let retry = ObservationRetry::new(3);
        assert_eq!(retry.after_sleep(3), Retry::Again);
        assert_eq!(retry.after_sleep(4), Retry::Drop);
    }
}
