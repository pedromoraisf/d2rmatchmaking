//! The agent's timings (ADR 027, rule 4): domain constants, never read from the contract or a configuration file.
//! The values are the ones the core loops use today; the core keeps its own copies until each aggregate moves.

use std::time::Duration;

/// Period of the heartbeat.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

/// The server marks an agent offline after three missed heartbeats (AD-031). The constant documents that agreement.
pub const OFFLINE_AFTER: Duration = Duration::from_secs(45);

/// Period of the claim while a pairing code is shown.
pub const CLAIM_INTERVAL: Duration = Duration::from_secs(2);

/// Wait after a claim could not reach the API.
pub const UNREACHABLE_RETRY: Duration = Duration::from_secs(15);

/// Wait after a rate limit when the API sends no `Retry-After`.
pub const RATE_LIMIT_DEFAULT: Duration = Duration::from_secs(60 * 60);

/// Consecutive unused pairing codes before the claim pauses.
pub const UNUSED_LIMIT: u8 = 2;

/// Digits of a pairing code. Mirrors the contract's `^\d{6}$`; it replaces nothing.
pub const PAIRING_CODE_DIGITS: usize = 6;

/// Delays before observation attempts 2, 3, 4 and 5.
pub const OBSERVATION_RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
];

/// First reconnection delay of the event stream.
pub const RECONNECT_MIN: Duration = Duration::from_secs(1);

/// Longest reconnection delay of the event stream.
pub const RECONNECT_MAX: Duration = Duration::from_secs(60);

/// A stream that stayed open at least this long resets the reconnection delay.
pub const RESET_AFTER_OPEN: Duration = Duration::from_secs(60);

/// Period of the update check.
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// The game process the presence check looks for.
pub const GAME_PROCESS: &str = "D2R.exe";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timing_constants_are_pinned() {
        assert_eq!(HEARTBEAT_INTERVAL, Duration::from_secs(15));
        assert_eq!(OFFLINE_AFTER, Duration::from_secs(45));
        assert_eq!(CLAIM_INTERVAL, Duration::from_secs(2));
        assert_eq!(UNREACHABLE_RETRY, Duration::from_secs(15));
        assert_eq!(RATE_LIMIT_DEFAULT, Duration::from_secs(60 * 60));
        assert_eq!(UNUSED_LIMIT, 2);
        assert_eq!(PAIRING_CODE_DIGITS, 6);
        assert_eq!(
            OBSERVATION_RETRY_DELAYS,
            [
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
            ]
        );
        assert_eq!(RECONNECT_MIN, Duration::from_secs(1));
        assert_eq!(RECONNECT_MAX, Duration::from_secs(60));
        assert_eq!(RESET_AFTER_OPEN, Duration::from_secs(60));
        assert_eq!(CHECK_EVERY, Duration::from_secs(6 * 60 * 60));
        assert_eq!(GAME_PROCESS, "D2R.exe");
    }

    #[test]
    fn offline_threshold_is_three_heartbeats() {
        assert_eq!(OFFLINE_AFTER, 3 * HEARTBEAT_INTERVAL);
    }
}
