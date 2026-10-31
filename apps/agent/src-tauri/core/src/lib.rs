//! Agent core: every rule the agent follows, behind ports. No Tauri, no Cargo features (AGS-01).
#![forbid(unsafe_code)]

pub mod api_client;
pub mod config;
pub mod context;
pub mod contracts;
pub mod heartbeat;
pub mod pairing;
pub mod ports;
pub mod secret;
pub mod stream;
pub mod telemetry;
pub mod view;

#[cfg(test)]
mod tests {
    #[test]
    fn core_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-core");
    }
}
