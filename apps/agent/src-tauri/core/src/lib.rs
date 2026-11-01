//! Agent core: every rule the agent follows, behind ports. No Tauri, no Cargo features (AGS-01).
#![forbid(unsafe_code)]

pub mod beat;
pub mod check_update;
pub mod config;
pub mod device_state;
pub mod fakes;
pub mod follow_stream;
pub mod fusion;
pub mod groups;
pub mod hub;
pub mod messages;
pub mod pair;
pub mod ports;
pub mod post_observation;
pub mod read_frame;
pub mod runtime;
pub mod secret;
pub mod view;

#[cfg(test)]
mod tests {
    #[test]
    fn core_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-core");
    }
}
