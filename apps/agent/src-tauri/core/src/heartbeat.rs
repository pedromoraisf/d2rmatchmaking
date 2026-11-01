//! The heartbeat loop (design.md § Heartbeat and process; AGS-10, AGS-11; AD-031, AD-055).
//!
//! While paired and no update is pending, the agent beats at once and then every 15 s. `game.running` is true exactly when
//! a process named `D2R.exe` is in the process snapshot (names only, ASCII case-insensitive). A failed beat shows
//! "Can't reach the server" and the next beat stays on schedule; a success shows "Connected".

use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;

use crate::context::Context;
use crate::device_state::DeviceState;
use crate::messages::{Presence, Screen};
use crate::ports::{ApiError, ApiGateway};
use crate::view::Connectivity;

/// The interval between heartbeats (AD-031).
pub const INTERVAL: Duration = Duration::from_secs(15);

/// The executable whose presence means the game is open (AD-055).
pub const GAME_PROCESS: &str = "D2R.exe";

/// Beats for the life of the agent, whenever it is paired and not waiting for an update.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(ctx: Arc<Context<G>>) {
    let mut next = Instant::now();
    loop {
        ctx.device
            .wait_until_allowed(DeviceState::api_allowed)
            .await;
        if !ctx
            .device
            .sleep_while_allowed(next, DeviceState::api_allowed)
            .await
        {
            continue;
        }
        // The schedule starts with the beat, so a slow answer does not move the next beat.
        let started = Instant::now();
        let span = tracing::info_span!("agent.heartbeat");
        beat(&ctx).instrument(span).await;
        next = started + INTERVAL;
    }
}

/// One heartbeat: builds the body from the process snapshot and sends it with the stored token.
async fn beat<G: ApiGateway + Send + Sync>(ctx: &Context<G>) {
    let Some(token) = ctx.tokens.load() else {
        return;
    };
    let presence = Presence {
        game_running: game_running(&ctx.processes.names()),
        // The screen is unknown until F2 reads it (AGS-10).
        screen: Screen::Unknown,
    };
    // A version the contract refuses fails in the gateway's translation, before anything is sent, and shows as unreachable.
    match ctx.gateway.heartbeat(&token, &presence, &ctx.version).await {
        Ok(()) => ctx.device.hub.set_connectivity(Connectivity::Connected),
        Err(error @ (ApiError::Unauthorized | ApiError::UpgradeRequired)) => {
            ctx.handle_api_error(&error);
        }
        Err(_) => ctx.device.hub.set_connectivity(Connectivity::Unreachable),
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
    use std::time::Duration;

    use super::{INTERVAL, game_running};

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
}
