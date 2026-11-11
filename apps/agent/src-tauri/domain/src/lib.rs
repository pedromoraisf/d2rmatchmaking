//! Agent domain: the rules of the desktop agent (ADR 027). No I/O, no async, no clock, no randomness, no contract types.
//! Time and identifiers enter as arguments.
#![forbid(unsafe_code)]

pub mod characters;
pub mod fusion;
pub mod language;
pub mod layout;
pub mod observation_retry;
pub mod paired_device;
pub mod pairing;
pub mod presence;
pub mod reconnect;
pub mod room_assignment;
pub mod timings;
pub mod vision;

#[cfg(test)]
mod tests {
    #[test]
    fn domain_crate_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-domain");
    }
}
