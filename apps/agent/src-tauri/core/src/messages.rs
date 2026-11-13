//! The plain messages the ports exchange (design.md § Migration Steps, M1a). They hold no serde and no generated contract
//! type: the anti-corruption layer translates between them and the contract types. The room assignment has moved to the
//! domain (M2) and the pairing code has moved there too (M3); the issued code, observation and presence messages stay
//! here until M5 moves them.

use chrono::{DateTime, Utc};

use crate::secret::Secret;

/// The pairing code is the domain's value object (M3): six ASCII digits, validated on construction.
pub use d2rmm_agent_domain::pairing::{InvalidPairingCode, PairingCode};

/// A code the API issued, with the claim secret that goes with it. `Debug` shows the secret as `***` (`Secret`).
#[derive(Debug, Clone)]
pub struct IssuedCode {
    pub code: PairingCode,
    pub expires_at: DateTime<Utc>,
    pub claim_secret: Secret,
}

/// The `GAME_NAME_SEEN` observation is the domain's value object (M5): fusion builds it and the sender posts it as is.
pub use d2rmm_agent_domain::fusion::GameNameObservation;

/// The heartbeat's presence and screen are the domain's value objects (M5).
pub use d2rmm_agent_domain::presence::{Presence, Screen};

/// A ready check the account's group opened (RDY-01), as the agent needs it: the id to answer and the time left to answer
/// it, measured on the server's clock when the agent heard of it. The agent counts that time on its own monotonic clock,
/// so a wrong clock on this PC changes nothing (RDY-11). The members stay on the server and the site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyCheckOpen {
    pub id: String,
    pub remaining: std::time::Duration,
}

/// The end of a ready check the agent was told of (RDY-03 … RDY-05): the id it ended with. The outcome is not needed to
/// stop answering it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyCheckEnd {
    pub id: String,
}

/// What one frame shows: its screen, and the complete cards when it is the character selection screen (CHR-04, CHR-06).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameReading {
    pub screen: Screen,
    pub cards: Vec<d2rmm_agent_domain::characters::Card>,
    /// How many card slots held text, and why each slot that settled no card did not. Local diagnostics only.
    pub slots_read: u8,
    pub rejected: Vec<d2rmm_agent_domain::character_screen::Rejection>,
}

impl FrameReading {
    /// A frame that shows no card.
    pub fn without_cards(screen: Screen) -> Self {
        Self {
            screen,
            cards: Vec::new(),
            slots_read: 0,
            rejected: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};

    use super::{IssuedCode, PairingCode};
    use crate::secret::Secret;

    const CLAIM_SECRET: &str = "claim-secret-7f3a9c1e5b2d";

    #[test]
    fn pairing_code_accepts_six_digits_only() {
        for valid in ["000000", "123456", "907314"] {
            assert!(PairingCode::new(valid).is_ok(), "{valid:?} is six digits");
        }
        for invalid in [
            "", "12345", "1234567", "12a456", "123 56", "-23456", "123456\n",
        ] {
            assert!(
                PairingCode::new(invalid).is_err(),
                "{invalid:?} is not six digits"
            );
        }
    }

    #[test]
    fn issued_code_debug_never_contains_the_claim_secret() {
        let expires_at: DateTime<Utc> = "2026-11-01T10:05:00Z".parse().expect("a valid instant");
        let issued = IssuedCode {
            code: PairingCode::new("123456").expect("six digits"),
            expires_at,
            claim_secret: Secret::new(CLAIM_SECRET),
        };

        let shown = format!("{issued:?}");

        assert!(
            !shown.contains(CLAIM_SECRET),
            "{shown} shows the claim secret"
        );
        assert!(shown.contains("123456"), "the code itself is shown");
    }
}
