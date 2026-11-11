//! Fusion (AHM-12, AHM-15; AD-052; AGN-03). A read game name becomes a `GAME_NAME_SEEN` observation only when it names the
//! assigned room: trimmed, without case, and with the D2R glyph rules of `game_name_match`. Any other name, and a masked
//! field, yields nothing. The rule reads no clock and draws no idempotency key unless the name matches: the caller passes
//! the capture time and a key source.

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::game_name_match::{FieldRead, read_field};
use crate::room_assignment::Assignment;
use crate::vision::ReadText;

/// A `GAME_NAME_SEEN` observation, ready to be posted to its room.
#[derive(Debug, Clone, PartialEq)]
pub struct GameNameObservation {
    pub room: Uuid,
    pub run: NonZeroU64,
    pub key: Uuid,
    pub game_name: String,
    pub confidence: f64,
    pub captured_at: DateTime<Utc>,
}

/// Accepts the read only when `read_field` matches it to the expected game name (AD-052, AGN-03). The observation carries
/// the expected name in its normal form (trimmed, lower-cased), the assignment's run and room, a confidence clamped to
/// [0, 1] (NaN counts as 0), the key from `key` and the capture time. A room id that is not a UUID yields nothing.
pub fn fuse(
    read: &ReadText,
    assignment: &Assignment,
    now_utc: DateTime<Utc>,
    key: impl FnOnce() -> Uuid,
) -> Option<GameNameObservation> {
    let expected = assignment.expected_game_name.as_str();
    if read_field(&read.text, expected) != FieldRead::Matched {
        return None;
    }
    let room = Uuid::parse_str(assignment.room.as_str()).ok()?;
    let confidence = if read.confidence.is_nan() {
        0.0
    } else {
        read.confidence.clamp(0.0, 1.0)
    };
    Some(GameNameObservation {
        room,
        run: assignment.run,
        key: key(),
        game_name: expected.trim().to_lowercase(),
        confidence,
        captured_at: now_utc,
    })
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::num::NonZeroU64;

    use chrono::{DateTime, TimeZone, Utc};
    use uuid::Uuid;

    use super::{GameNameObservation, fuse};
    use crate::room_assignment::{Assignment, GameName, RoomId};
    use crate::vision::ReadText;

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    fn assignment() -> Assignment {
        Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(3).expect("a non-zero run"),
            expected_game_name: GameName::new("mmbaalh-12"),
            members: Vec::new(),
        }
    }

    fn now() -> DateTime<Utc> {
        Utc.timestamp_opt(1_000_000, 0)
            .single()
            .expect("a valid instant")
    }

    fn key() -> Uuid {
        Uuid::from_u128(7)
    }

    fn read(text: &str, confidence: f64) -> ReadText {
        ReadText {
            text: text.to_string(),
            confidence,
        }
    }

    #[test]
    fn fuse_exact_match_after_trim_and_lowercase() {
        for seen in ["mmbaalh-12", "MMBAALH-12 ", "  MmBaAlH-12\t"] {
            let observation: GameNameObservation =
                fuse(&read(seen, 0.93), &assignment(), now(), key)
                    .expect("the trimmed, lower-cased name matches");

            assert_eq!(observation.game_name, "mmbaalh-12", "the normalised text");
            assert_eq!(
                observation.room,
                ROOM.parse::<Uuid>().expect("a UUID room"),
                "the assignment's room"
            );
            assert_eq!(observation.run.get(), 3, "the assignment's run");
            assert_eq!(observation.key, key(), "the key the caller supplied");
            assert_eq!(observation.captured_at, now(), "the capture time");
        }
    }

    #[test]
    fn fuse_ignores_a_distance_one_name() {
        for seen in ["mmbaalh-13", "mmbaalh-1", " mmbaalh-12x", ""] {
            assert_eq!(
                fuse(&read(seen, 0.93), &assignment(), now(), key),
                None,
                "{seen:?} must not match"
            );
        }
    }

    #[test]
    fn fuse_clamps_confidence_and_maps_nan_to_zero() {
        let high =
            fuse(&read("mmbaalh-12", 1.7), &assignment(), now(), key).expect("the name matches");
        let low =
            fuse(&read("mmbaalh-12", -0.5), &assignment(), now(), key).expect("the name matches");
        let missing = fuse(&read("mmbaalh-12", f64::NAN), &assignment(), now(), key)
            .expect("the name matches");

        assert!((high.confidence - 1.0).abs() < 1e-12, "above one is one");
        assert!(low.confidence.abs() < 1e-12, "below zero is zero");
        assert!(missing.confidence.abs() < 1e-12, "NaN is zero");
    }

    #[test]
    fn fuse_refuses_a_non_uuid_room() {
        let assignment = Assignment {
            room: RoomId::new("not-a-uuid"),
            ..assignment()
        };

        assert_eq!(
            fuse(&read("mmbaalh-12", 0.93), &assignment, now(), key),
            None,
            "a room id that is not a UUID yields nothing"
        );
    }

    #[test]
    fn fuse_reads_the_d2r_glyphs_and_reports_the_expected_name() {
        let observation = fuse(
            &read("MMC⊕WSH-1", 0.93),
            &assignment_named("mmcowsh-1"),
            now(),
            key,
        )
        .expect("the O drawn as ⊕ matches the expected name");
        assert_eq!(
            observation.game_name, "mmcowsh-1",
            "the expected name, not the glyphs"
        );

        assert!(
            fuse(
                &read("MMCOWSH-1O", 0.93),
                &assignment_named("mmcowsh-10"),
                now(),
                key
            )
            .is_some(),
            "the letter O after the dash reads as zero"
        );
        assert_eq!(
            fuse(
                &read("xxxxxxxxx", 0.93),
                &assignment_named("mmcowsh-1"),
                now(),
                key
            ),
            None,
            "a masked field is never a match"
        );
    }

    fn assignment_named(name: &str) -> Assignment {
        Assignment {
            expected_game_name: GameName::new(name),
            ..assignment()
        }
    }

    #[test]
    fn fuse_draws_a_key_only_on_a_match() {
        let drawn = Cell::new(0_u32);
        let draw = || {
            drawn.set(drawn.get() + 1);
            key()
        };

        assert_eq!(
            fuse(&read("mmbaalh-13", 0.93), &assignment(), now(), draw),
            None
        );
        assert_eq!(drawn.get(), 0, "a name that does not match draws no key");

        assert!(fuse(&read("mmbaalh-12", 0.93), &assignment(), now(), draw).is_some());
        assert_eq!(drawn.get(), 1, "a match draws exactly one key");
    }
}
