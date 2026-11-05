//! The pairing rules (AHM-07, AHM-15; AD-050, AD-058). A pairing code is shown until it is claimed, expires or its claim
//! is refused. Two codes in a row that expire unused pause the loop. The aggregate decides what follows each answer; it
//! reads no clock. Time comes in as an argument, and the core loop does the waiting.

use std::time::Duration;

use chrono::{DateTime, Utc};

use crate::timings::{
    CLAIM_INTERVAL, PAIRING_CODE_DIGITS, RATE_LIMIT_DEFAULT, UNREACHABLE_RETRY, UNUSED_LIMIT,
};

/// A six-digit pairing code, as the API issues it (`^\d{6}$`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingCode(String);

/// The value is not six ASCII digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a pairing code is six ASCII digits")]
pub struct InvalidPairingCode;

impl PairingCode {
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidPairingCode> {
        let value = value.into();
        let valid =
            value.len() == PAIRING_CODE_DIGITS && value.bytes().all(|byte| byte.is_ascii_digit());
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidPairingCode)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What the API answered to a claim of the shown code. A `426` is not here: the device aggregate handles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimOutcome {
    /// The token was issued.
    Claimed,
    /// The code is not claimed yet.
    Pending,
    /// The code is gone (answered `410`).
    Gone,
    /// The claim was refused as unauthorized (`401`).
    Unauthorized,
    /// The claim was rate limited (`429`), with the API's `Retry-After` when it sent one.
    RateLimited { retry_after: Option<Duration> },
    /// The API could not be reached, or it failed.
    Unreachable,
}

/// What the loop does after a code expired unused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeNext {
    /// Request a new code.
    NewCode,
    /// Pause until the player asks for a new code.
    Pause,
}

/// What the loop does after a claim answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimNext {
    /// Claim the same code again after this wait.
    ClaimAfter(Duration),
    /// The token was issued: store it, and the agent is paired.
    Paired,
    /// Request a new code after this wait.
    RestartAfter(Duration),
    /// Request a new code at once (`401`).
    Restart,
    /// The code is over. The unused count decides whether the loop pauses.
    Expired(CodeNext),
}

/// The pairing state: the code on screen, its expiry and the consecutive unused count.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Pairing {
    code: Option<(PairingCode, DateTime<Utc>)>,
    unused: u8,
}

impl Pairing {
    /// Nothing is shown and no code has expired unused.
    pub fn new() -> Self {
        Self::default()
    }

    /// Shows `code`, which expires at `expires_at`.
    pub fn show(&mut self, code: PairingCode, expires_at: DateTime<Utc>) {
        self.code = Some((code, expires_at));
    }

    /// The code on screen, if any.
    pub fn code(&self) -> Option<&PairingCode> {
        self.code.as_ref().map(|(code, _)| code)
    }

    /// When the code on screen expires, if one is shown.
    pub fn expires_at(&self) -> Option<DateTime<Utc>> {
        self.code.as_ref().map(|(_, expires_at)| *expires_at)
    }

    /// Consecutive codes that expired unused since the last pause or refused claim.
    pub fn unused(&self) -> u8 {
        self.unused
    }

    /// Applies the answer to a claim of the shown code.
    pub fn claim_result(&mut self, outcome: ClaimOutcome) -> ClaimNext {
        match outcome {
            ClaimOutcome::Claimed => ClaimNext::Paired,
            ClaimOutcome::Pending => ClaimNext::ClaimAfter(CLAIM_INTERVAL),
            ClaimOutcome::Gone => ClaimNext::Expired(self.expired()),
            ClaimOutcome::Unauthorized => {
                self.unused = 0;
                ClaimNext::Restart
            }
            ClaimOutcome::RateLimited { retry_after } => {
                ClaimNext::RestartAfter(Self::rate_limited(retry_after))
            }
            ClaimOutcome::Unreachable => ClaimNext::RestartAfter(UNREACHABLE_RETRY),
        }
    }

    /// Counts one code that expired unused. At `UNUSED_LIMIT` the loop pauses and the count starts over.
    pub fn expired(&mut self) -> CodeNext {
        self.unused = self.unused.saturating_add(1);
        if self.unused >= UNUSED_LIMIT {
            self.unused = 0;
            CodeNext::Pause
        } else {
            CodeNext::NewCode
        }
    }

    /// The wait after a `429`: the API's `Retry-After`, or sixty minutes when it sent none (AD-058).
    pub fn rate_limited(retry_after: Option<Duration>) -> Duration {
        retry_after.unwrap_or(RATE_LIMIT_DEFAULT)
    }

    /// The time left until `expires_at`; zero once it has passed.
    pub fn remaining_until(expires_at: DateTime<Utc>, now: DateTime<Utc>) -> Duration {
        (expires_at - now).to_std().unwrap_or(Duration::ZERO)
    }

    /// Minutes left, rounded up: 5 for a fresh code, 1 in its last minute (AGS-05).
    pub fn minutes_left(remaining: Duration) -> u8 {
        let minute = Duration::from_secs(60).as_millis();
        let minutes = remaining.as_millis().div_ceil(minute);
        u8::try_from(minutes).unwrap_or(u8::MAX)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use chrono::{DateTime, TimeZone, Utc};

    use super::{ClaimNext, ClaimOutcome, CodeNext, Pairing, PairingCode};

    fn code() -> PairingCode {
        PairingCode::new("123456").expect("six digits")
    }

    fn at(seconds: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(seconds, 0)
            .single()
            .expect("a valid instant")
    }

    #[test]
    fn pairing_code_accepts_six_digits_only() {
        assert!(PairingCode::new("000000").is_ok());
        assert!(PairingCode::new("12345").is_err());
        assert!(PairingCode::new("1234567").is_err());
        assert!(PairingCode::new("12345a").is_err());
        assert!(PairingCode::new("\u{661}\u{662}\u{663}\u{664}\u{665}\u{666}").is_err());
    }

    #[test]
    fn show_holds_the_code_and_its_expiry() {
        let mut pairing = Pairing::new();

        pairing.show(code(), at(300));

        assert_eq!(pairing.code().map(PairingCode::as_str), Some("123456"));
        assert_eq!(pairing.expires_at(), Some(at(300)));
    }

    #[test]
    fn pairing_claims_every_two_seconds_and_pauses_after_two_unused_codes() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));

        assert_eq!(
            pairing.claim_result(ClaimOutcome::Pending),
            ClaimNext::ClaimAfter(Duration::from_secs(2))
        );
        assert_eq!(pairing.expired(), CodeNext::NewCode);
        assert_eq!(pairing.expired(), CodeNext::Pause);
    }

    #[test]
    fn claimed_pairs_the_agent() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));

        assert_eq!(
            pairing.claim_result(ClaimOutcome::Claimed),
            ClaimNext::Paired
        );
    }

    #[test]
    fn gone_counts_as_expiry() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));

        assert_eq!(
            pairing.claim_result(ClaimOutcome::Gone),
            ClaimNext::Expired(CodeNext::NewCode)
        );
        assert_eq!(pairing.unused(), 1);
        assert_eq!(
            pairing.claim_result(ClaimOutcome::Gone),
            ClaimNext::Expired(CodeNext::Pause)
        );
        assert_eq!(pairing.unused(), 0);
    }

    #[test]
    fn unauthorized_resets_unused_count() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));
        pairing.expired();
        assert_eq!(pairing.unused(), 1);

        assert_eq!(
            pairing.claim_result(ClaimOutcome::Unauthorized),
            ClaimNext::Restart
        );

        assert_eq!(pairing.unused(), 0);
        assert_eq!(
            pairing.expired(),
            CodeNext::NewCode,
            "the count started over, so one more expiry does not pause"
        );
    }

    #[test]
    fn rate_limit_waits_retry_after_or_sixty_minutes() {
        assert_eq!(Pairing::rate_limited(None), Duration::from_secs(60 * 60));
        assert_eq!(
            Pairing::rate_limited(Some(Duration::from_secs(30))),
            Duration::from_secs(30)
        );

        let mut pairing = Pairing::new();
        assert_eq!(
            pairing.claim_result(ClaimOutcome::RateLimited { retry_after: None }),
            ClaimNext::RestartAfter(Duration::from_secs(60 * 60))
        );
        assert_eq!(
            pairing.claim_result(ClaimOutcome::RateLimited {
                retry_after: Some(Duration::from_secs(30)),
            }),
            ClaimNext::RestartAfter(Duration::from_secs(30))
        );
    }

    #[test]
    fn unreachable_waits_fifteen_seconds_then_restarts() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));

        assert_eq!(
            pairing.claim_result(ClaimOutcome::Unreachable),
            ClaimNext::RestartAfter(Duration::from_secs(15))
        );
        assert_eq!(
            pairing.unused(),
            0,
            "an unreachable API counts no unused code"
        );
    }

    #[test]
    fn unused_limit_boundary_both_sides() {
        let mut pairing = Pairing::new();
        pairing.show(code(), at(300));

        assert_eq!(
            pairing.expired(),
            CodeNext::NewCode,
            "one unused code is below the limit"
        );
        assert_eq!(pairing.unused(), 1);
        assert_eq!(
            pairing.claim_result(ClaimOutcome::Pending),
            ClaimNext::ClaimAfter(Duration::from_secs(2)),
            "a pending answer does not count"
        );
        assert_eq!(
            pairing.expired(),
            CodeNext::Pause,
            "the second unused code reaches the limit"
        );
        assert_eq!(pairing.unused(), 0);
    }

    #[test]
    fn remaining_until_is_zero_once_the_code_has_expired() {
        assert_eq!(
            Pairing::remaining_until(at(300), at(100)),
            Duration::from_secs(200)
        );
        assert_eq!(Pairing::remaining_until(at(100), at(300)), Duration::ZERO);
    }

    #[test]
    fn minutes_left_rounds_up_at_every_offset() {
        assert_eq!(Pairing::minutes_left(Duration::from_millis(1)), 1);
        assert_eq!(Pairing::minutes_left(Duration::from_millis(59_900)), 1);
        assert_eq!(Pairing::minutes_left(Duration::from_secs(60)), 1);
        assert_eq!(Pairing::minutes_left(Duration::from_millis(60_100)), 2);
        assert_eq!(Pairing::minutes_left(Duration::from_secs(270)), 5);
        assert_eq!(Pairing::minutes_left(Duration::from_secs(300)), 5);
    }
}
