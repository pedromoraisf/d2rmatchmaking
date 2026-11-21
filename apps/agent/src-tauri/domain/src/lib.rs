//! Agent domain: the rules of the desktop agent (ADR 027). No I/O, no async, no clock, no randomness, no contract types.
//! Time and identifiers enter as arguments.
#![forbid(unsafe_code)]

pub mod anchors;
pub mod capture_cascade;
pub mod capture_geometry;
pub mod character_screen;
pub mod characters;
pub mod chat;
pub mod frame_content;
pub mod fusion;
pub mod game_name_match;
pub mod hud_track;
pub mod language;
pub mod layout;
pub mod name_diff;
pub mod observation_retry;
pub mod paired_device;
pub mod pairing;
pub mod presence;
pub mod reconnect;
pub mod remote_config;
pub mod room_assignment;
pub mod timings;
pub mod typing;
pub mod vision;
pub mod vocabulary;

#[cfg(test)]
mod tests {
    #[test]
    fn domain_crate_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-domain");
    }
}
