//! The heartbeat loop (design.md § Heartbeat and process; AGS-10, AGS-11; AD-031, AD-055).
//!
//! While paired and no update is pending, the agent beats at once and then every 15 s. `game.running` is true exactly when
//! a process named `D2R.exe` is in the process snapshot (names only, ASCII case-insensitive). A failed beat shows
//! "Can't reach the server" and the next beat stays on schedule; a success shows "Connected".

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::time::Instant;
use tracing::Instrument;

use crate::api_client::ApiError;
use crate::context::Context;
use crate::contracts::generated::Heartbeat;
use crate::view::Connectivity;

/// The interval between heartbeats (AD-031).
pub const INTERVAL: Duration = Duration::from_secs(15);

/// The executable whose presence means the game is open (AD-055).
pub const GAME_PROCESS: &str = "D2R.exe";

/// Beats for the life of the agent, whenever it is paired and not waiting for an update.
pub async fn run(ctx: Arc<Context>) {
    let mut next = Instant::now();
    loop {
        ctx.wait_until_allowed(Context::api_allowed).await;
        if !ctx.sleep_while_allowed(next, Context::api_allowed).await {
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
async fn beat(ctx: &Context) {
    let Some(token) = ctx.tokens.load() else {
        return;
    };
    let running = game_running(&ctx.processes.names());
    let Ok(body) = heartbeat_body(&ctx.version, running) else {
        // The version is not a contract version: a build error, nothing to send.
        ctx.hub.set_connectivity(Connectivity::Unreachable);
        return;
    };
    match ctx.api.heartbeat(&token, &body).await {
        Ok(()) => ctx.hub.set_connectivity(Connectivity::Connected),
        Err(ApiError::Unauthorized) => ctx.on_unauthorized(),
        Err(ApiError::UpgradeRequired) => ctx.on_upgrade_required(),
        Err(_) => ctx.hub.set_connectivity(Connectivity::Unreachable),
    }
}

/// Whether a process named `D2R.exe` is in the snapshot.
pub fn game_running(names: &[String]) -> bool {
    names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(GAME_PROCESS))
}

/// The heartbeat body of the contract: the version, the game state and the screen (`UNKNOWN` in F0).
pub fn heartbeat_body(version: &str, running: bool) -> Result<Heartbeat, serde_json::Error> {
    serde_json::from_value(json!({
        "agentVersion": version,
        "pcState": "IDLE",
        "game": { "running": running, "window": "", "screen": "UNKNOWN" },
        "capture": { "method": "none", "readRate": 0 },
    }))
}

#[cfg(test)]
mod tests {
    use super::{game_running, heartbeat_body};

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

    #[test]
    fn heartbeat_body_follows_the_contract() {
        let body = heartbeat_body("0.0.1", true).expect("a contract body");
        let sent = serde_json::to_value(&body).expect("the body serializes");
        assert_eq!(sent["game"]["screen"], "UNKNOWN");
        assert_eq!(sent["game"]["running"].as_bool(), Some(true));
        assert_eq!(sent["agentVersion"], "0.0.1");
        assert!(heartbeat_body("not-a-version", false).is_err());
    }
}
