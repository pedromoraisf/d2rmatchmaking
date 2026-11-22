//! The agent saw its player in another game (agent-room-lifecycle ARL-08, ARL-09): an `OTHER_GAME_SEEN` observation for the held
//! run, ready to be posted to its room. It carries no name: the other game's name is read to be compared with the held one and
//! is never kept, logged, put in a span or sent. Pure: no I/O, no clock, no randomness, no contract type.

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// An `OTHER_GAME_SEEN` observation. It has no value: the contract sends an empty one.
#[derive(Debug, Clone, PartialEq)]
pub struct OtherGameObservation {
    pub room: Uuid,
    pub run: NonZeroU64,
    pub key: Uuid,
    pub confidence: f64,
    pub captured_at: DateTime<Utc>,
}

impl OtherGameObservation {
    /// The observation. The confidence is clamped to [0, 1] (NaN is 0).
    pub fn of(
        room: Uuid,
        run: NonZeroU64,
        key: Uuid,
        confidence: f64,
        captured_at: DateTime<Utc>,
    ) -> Self {
        let confidence = if confidence.is_nan() {
            0.0
        } else {
            confidence.clamp(0.0, 1.0)
        };
        Self {
            room,
            run,
            key,
            confidence,
            captured_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    use super::OtherGameObservation;

    fn observation(confidence: f64) -> OtherGameObservation {
        OtherGameObservation::of(
            Uuid::from_u128(1),
            NonZeroU64::MIN,
            Uuid::from_u128(2),
            confidence,
            Utc.timestamp_opt(1_000_000, 0)
                .single()
                .expect("a valid instant"),
        )
    }

    #[test]
    fn the_confidence_is_clamped_and_nan_is_zero() {
        assert!((observation(1.7).confidence - 1.0).abs() < f64::EPSILON);
        assert!(observation(-0.2).confidence.abs() < f64::EPSILON);
        assert!(observation(f64::NAN).confidence.abs() < f64::EPSILON);
        assert!((observation(0.4).confidence - 0.4).abs() < f64::EPSILON);
    }
}
