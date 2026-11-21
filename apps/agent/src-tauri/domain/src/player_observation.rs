//! A player the chat said joined or left, ready to be posted to its room (server-name-match SNM-05, SNM-06). The value is
//! the one character name the chat line read, and it is checked against the reading rule of the contract's
//! `PlayerNameValue` before an observation exists: 2 to 15 characters of letters and the digits 0 and 1 (what the screen
//! reads for `o`, `i` and `l`), first and last a letter, at most one inner `-` or `_`. A name that breaks the rule is
//! refused; nothing about it is kept. Pure: no I/O, no clock, no randomness, no contract type.

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// What the chat said happened to the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerKind {
    Joined,
    Left,
}

impl PlayerKind {
    /// The fixed word a span or a counter carries: never a name.
    pub fn word(self) -> &'static str {
        match self {
            Self::Joined => "joined",
            Self::Left => "left",
        }
    }
}

/// A name that the reading rule refuses. It carries nothing: not the name, not its length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NameRefused;

/// A `PLAYER_JOINED_SEEN` or `PLAYER_LEFT_SEEN` observation. `Debug` hides the name.
#[derive(Clone, PartialEq)]
pub struct PlayerObservation {
    pub kind: PlayerKind,
    pub room: Uuid,
    pub run: NonZeroU64,
    pub key: Uuid,
    name: String,
    pub confidence: f64,
    pub captured_at: DateTime<Utc>,
}

impl std::fmt::Debug for PlayerObservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlayerObservation")
            .field("kind", &self.kind)
            .field("room", &self.room)
            .field("run", &self.run)
            .field("key", &self.key)
            .field("name", &"<hidden>")
            .field("confidence", &self.confidence)
            .field("captured_at", &self.captured_at)
            .finish()
    }
}

impl PlayerObservation {
    /// The observation, or `NameRefused` when `name` breaks the reading rule. The confidence is clamped to [0, 1] (NaN is 0).
    pub fn of(
        kind: PlayerKind,
        room: Uuid,
        run: NonZeroU64,
        key: Uuid,
        name: &str,
        confidence: f64,
        captured_at: DateTime<Utc>,
    ) -> Result<Self, NameRefused> {
        if !is_player_name(name) {
            return Err(NameRefused);
        }
        let confidence = if confidence.is_nan() {
            0.0
        } else {
            confidence.clamp(0.0, 1.0)
        };
        Ok(Self {
            kind,
            room,
            run,
            key,
            name: name.to_string(),
            confidence,
            captured_at,
        })
    }

    /// The name, for the contract body and nowhere else.
    pub fn name(&self) -> &str {
        &self.name
    }
}

/// The reading rule (`PlayerNameValue`): 2 to 15 characters of ASCII letters and `0` and `1`, with at most one `-` or `_`,
/// which is neither first nor last; the first and the last character are letters.
pub fn is_player_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if !(2..=15).contains(&bytes.len()) {
        return false;
    }
    let (first, last) = (bytes[0], bytes[bytes.len() - 1]);
    if !first.is_ascii_alphabetic() || !last.is_ascii_alphabetic() {
        return false;
    }
    let mut separators = 0;
    for &byte in &bytes[1..bytes.len() - 1] {
        match byte {
            b'-' | b'_' => separators += 1,
            b'0' | b'1' => {}
            _ if byte.is_ascii_alphabetic() => {}
            _ => return false,
        }
    }
    // A separator is never first or last (checked above), and one run of them is not a name.
    separators <= 1
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use chrono::{DateTime, Utc};
    use uuid::Uuid;

    use super::{NameRefused, PlayerKind, PlayerObservation, is_player_name};

    fn at() -> DateTime<Utc> {
        "2026-11-21T10:00:00Z".parse().expect("a valid instant")
    }

    fn make(name: &str, confidence: f64) -> Result<PlayerObservation, NameRefused> {
        PlayerObservation::of(
            PlayerKind::Joined,
            Uuid::nil(),
            NonZeroU64::new(2).expect("non-zero"),
            Uuid::nil(),
            name,
            confidence,
            at(),
        )
    }

    #[test]
    fn names_the_rule_accepts() {
        for name in [
            "Bob",
            "Hammer",
            "Zzyzx",
            "Ab",
            "Sorc10r",
            "Sor-c",
            "Sor_c",
            "B1ob",
            "b0b",
            "Abcdefghijklmno",
        ] {
            assert!(is_player_name(name), "{name} is a name");
        }
    }

    #[test]
    fn names_the_rule_refuses() {
        for name in [
            "",
            "A",
            "Abcdefghijklmnop",
            "1Bob",
            "Bob1",
            "0b",
            "-Bob",
            "Bob-",
            "_Bob",
            "Bob_",
            "B-o-b",
            "B_o-b",
            "B--b",
            "Bo b",
            "Bo2b",
            "Bob!",
            "Bøb",
            "Bo.b",
            "Bo\nb",
        ] {
            assert!(!is_player_name(name), "{name:?} is not a name");
        }
    }

    #[test]
    fn the_length_bounds_are_two_and_fifteen() {
        assert!(!is_player_name("a"));
        assert!(is_player_name("ab"));
        assert!(is_player_name(&"a".repeat(15)));
        assert!(!is_player_name(&"a".repeat(16)));
    }

    #[test]
    fn a_refused_name_gives_no_observation_and_the_refusal_holds_nothing() {
        let refused = make("Zz yx!", 0.9).expect_err("refused");
        assert_eq!(format!("{refused:?}"), "NameRefused");
    }

    #[test]
    fn the_confidence_is_clamped_and_nan_is_zero() {
        assert_eq!(make("Bob", 1.7).expect("ok").confidence, 1.0);
        assert_eq!(make("Bob", -0.2).expect("ok").confidence, 0.0);
        assert_eq!(make("Bob", f64::NAN).expect("ok").confidence, 0.0);
        assert_eq!(make("Bob", 0.5).expect("ok").confidence, 0.5);
    }

    #[test]
    fn the_debug_form_hides_the_name_and_the_words_are_fixed() {
        let observation = make("Zzyzx", 0.8).expect("ok");
        assert!(!format!("{observation:?}").contains("Zzyzx"));
        assert_eq!(observation.name(), "Zzyzx");
        assert_eq!(PlayerKind::Joined.word(), "joined");
        assert_eq!(PlayerKind::Left.word(), "left");
    }
}
