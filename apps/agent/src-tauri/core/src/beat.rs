//! The beat use case (design.md § Heartbeat and process; AGS-10, AGS-11; AD-031, AD-055).
//!
//! While paired and no update is pending, the agent beats at once and then every 15 s. `game.running` is true exactly when
//! a process named `D2R.exe` is in the process snapshot (names only, ASCII case-insensitive). A failed beat shows
//! "Can't reach the server" and the next beat stays on schedule; a success shows "Connected".

use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;

use crate::context::HeartbeatPorts;
use crate::device_state::DeviceState;
use crate::messages::{Presence, Screen};
use crate::ports::{ApiError, ApiGateway};
use crate::view::Connectivity;

/// The interval between heartbeats (AD-031).
pub const INTERVAL: Duration = Duration::from_secs(15);

/// The executable whose presence means the game is open (AD-055).
pub const GAME_PROCESS: &str = "D2R.exe";

/// Beats for the life of the agent, whenever it is paired and not waiting for an update.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: HeartbeatPorts<G>,
    version: String,
) {
    let mut next = Instant::now();
    loop {
        device.wait_until_allowed(DeviceState::api_allowed).await;
        if !device
            .sleep_while_allowed(next, DeviceState::api_allowed)
            .await
        {
            continue;
        }
        // The schedule starts with the beat, so a slow answer does not move the next beat.
        let started = Instant::now();
        let span = tracing::info_span!("agent.heartbeat");
        beat(&device, &ports, &version).instrument(span).await;
        next = started + INTERVAL;
    }
}

/// One heartbeat: builds the body from the process snapshot and sends it with the stored token.
async fn beat<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &HeartbeatPorts<G>,
    version: &str,
) {
    let Some(token) = ports.tokens.load() else {
        return;
    };
    let presence = Presence {
        game_running: game_running(&ports.processes.names()),
        // The screen is unknown until F2 reads it (AGS-10).
        screen: Screen::Unknown,
    };
    // A version the contract refuses fails in the gateway's translation, before anything is sent, and shows as unreachable.
    match ports.gateway.heartbeat(&token, &presence, version).await {
        Ok(()) => device.hub.set_connectivity(Connectivity::Connected),
        Err(error @ (ApiError::Unauthorized | ApiError::UpgradeRequired)) => {
            device.handle_api_error(&error, ports.tokens.as_ref());
        }
        Err(_) => device.hub.set_connectivity(Connectivity::Unreachable),
    }
}

/// Whether a process named `D2R.exe` is in the snapshot.
pub fn game_running(names: &[String]) -> bool {
    names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(GAME_PROCESS))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::{INTERVAL, game_running, run};
    use crate::context::HeartbeatPorts;
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::messages::{Presence, Screen};
    use crate::ports::{ApiError, ProcessSource, TokenStore};
    use crate::secret::Secret;
    use crate::view::Connectivity;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    /// A process snapshot held in memory.
    struct Processes(Vec<String>);

    impl ProcessSource for Processes {
        fn names(&self) -> Vec<String> {
            self.0.clone()
        }
    }

    /// A paired device, its heartbeat ports and the gateway they share, all in memory.
    fn paired(
        gateway: &Arc<FakeApiGateway>,
        processes: Vec<String>,
    ) -> (Arc<DeviceState>, HeartbeatPorts<FakeApiGateway>) {
        let tokens = MemoryTokens::default();
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
        device.set_paired(true);
        let ports = HeartbeatPorts {
            gateway: Arc::clone(gateway),
            tokens: Arc::new(tokens),
            processes: Arc::new(Processes(processes)),
        };
        (device, ports)
    }

    fn beats(gateway: &FakeApiGateway) -> Vec<Call> {
        gateway
            .calls()
            .into_iter()
            .filter(|call| matches!(call, Call::Heartbeat { .. }))
            .collect()
    }

    #[test]
    fn heartbeat_interval_is_fifteen_seconds() {
        assert_eq!(INTERVAL, Duration::from_secs(15));
    }

    #[test]
    fn game_running_matches_the_executable_name_only() {
        assert!(game_running(&["explorer.exe".into(), "d2r.exe".into()]));
        assert!(game_running(&["D2R.EXE".into()]));
        assert!(!game_running(&[
            "D2R.exe.bak".into(),
            "d2r-helper.exe".into()
        ]));
        assert!(!game_running(&[]));
    }

    #[tokio::test(start_paused = true)]
    async fn beat_every_fifteen_seconds_with_running_flag() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_heartbeat([Ok(()), Ok(()), Ok(())]);
        let (device, ports) = paired(&gateway, vec!["explorer.exe".into(), "D2R.exe".into()]);
        tokio::spawn(run(Arc::clone(&device), ports, "0.0.1".to_string()));

        tokio::time::sleep(Duration::from_millis(14_500)).await;
        assert_eq!(beats(&gateway).len(), 1, "the first beat is at once");
        tokio::time::sleep(Duration::from_millis(1_000)).await;
        assert_eq!(beats(&gateway).len(), 2, "the next beat is at 15 s");
        tokio::time::sleep(Duration::from_secs(15)).await;
        assert_eq!(beats(&gateway).len(), 3, "and the one after at 30 s");

        let running = Presence {
            game_running: true,
            screen: Screen::Unknown,
        };
        for call in beats(&gateway) {
            assert_eq!(
                call,
                Call::Heartbeat {
                    presence: running,
                    version: "0.0.1".to_string(),
                },
                "D2R.exe in the snapshot sets game.running"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn beat_failure_shows_unreachable_then_connected() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_heartbeat([Err(ApiError::Server), Ok(())]);
        let (device, ports) = paired(&gateway, Vec::new());
        tokio::spawn(run(Arc::clone(&device), ports, "0.0.1".to_string()));

        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(
            device.hub.snapshot().connectivity,
            Connectivity::Unreachable,
            "a failed beat shows the server as unreachable"
        );

        tokio::time::sleep(Duration::from_secs(15)).await;
        assert_eq!(
            device.hub.snapshot().connectivity,
            Connectivity::Connected,
            "the next beat on schedule shows connected"
        );
        assert_eq!(
            beats(&gateway).len(),
            2,
            "the failure did not move the schedule"
        );
    }
}
