//! Agent core: every rule the agent follows, behind ports. No Tauri, no Cargo features (AGS-01).
#![forbid(unsafe_code)]

pub mod beat;
pub mod capturer;
pub mod check_update;
pub mod config;
pub mod device_state;
#[cfg(test)]
mod event_probe;
pub mod fakes;
pub mod fill_name;
pub mod follow_stream;
pub mod groups;
pub mod hub;
pub mod messages;
pub mod pair;
pub mod party;
pub mod ports;
pub mod post_observation;
pub mod read_frame;
pub mod ready_check;
pub mod runtime;
pub mod screen_reader;
pub mod secret;
pub mod title_ink;
pub mod view;
pub mod watch_screen;

#[cfg(test)]
mod tests {
    #[test]
    fn core_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-core");
    }
}
