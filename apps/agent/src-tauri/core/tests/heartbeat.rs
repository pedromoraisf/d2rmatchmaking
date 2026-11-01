//! AGS-10, AGS-11: heartbeats every 15 s whose `running` follows the process snapshot, and the connectivity they show.

mod support;

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_core::heartbeat;
use d2rmm_agent_core::view::Connectivity;
use support::fake_api::{Answer, Operation, TOKEN};
use support::harness::{Harness, advance, count, until};

fn spawn_heartbeat(h: &Harness) {
    tokio::spawn(heartbeat::run(Arc::clone(&h.context)));
}

fn connectivity(h: &Harness) -> Option<Connectivity> {
    h.sink.last().map(|view| view.connectivity)
}

/// The body of the most recent heartbeat the fake received.
fn last_body(h: &Harness) -> serde_json::Value {
    h.api
        .requests()
        .iter()
        .rev()
        .find(|request| request.operation == Operation::Heartbeat)
        .and_then(|request| request.body.clone())
        .expect("a heartbeat was received")
}

#[tokio::test(start_paused = true)]
async fn heartbeat_every_15s_with_running_flag() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.set_paired(true);
    spawn_heartbeat(&h);

    until("the first beat", || {
        count(&h.api, Operation::Heartbeat) == 1
    })
    .await;
    assert_eq!(
        last_body(&h)["game"]["running"].as_bool(),
        Some(false),
        "no game process yet"
    );

    advance(Duration::from_millis(14_900)).await;
    assert_eq!(
        count(&h.api, Operation::Heartbeat),
        1,
        "no beat before 15 s"
    );
    advance(Duration::from_millis(100)).await;
    until("the beat at 15 s", || {
        count(&h.api, Operation::Heartbeat) == 2
    })
    .await;

    h.processes.set(&["explorer.exe", "D2R.exe"]);
    advance(Duration::from_secs(15)).await;
    until("the beat at 30 s", || {
        count(&h.api, Operation::Heartbeat) == 3
    })
    .await;
    assert_eq!(
        last_body(&h)["game"]["running"].as_bool(),
        Some(true),
        "D2R.exe in the snapshot"
    );
    assert!(
        h.api
            .requests()
            .iter()
            .filter(|request| request.operation == Operation::Heartbeat)
            .all(|request| !request.invalid_body),
        "every heartbeat body validates against its schema"
    );
}

#[tokio::test(start_paused = true)]
async fn heartbeat_failure_shows_unreachable_then_connected() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.set_paired(true);
    h.api.refuse_connections().await;
    spawn_heartbeat(&h);
    until("the refused beat is shown", || {
        connectivity(&h) == Some(Connectivity::Unreachable)
    })
    .await;

    h.api.accept_connections().await;
    advance(Duration::from_secs(15)).await;
    until("connected after a success", || {
        connectivity(&h) == Some(Connectivity::Connected)
    })
    .await;
    assert_eq!(count(&h.api, Operation::Heartbeat), 1);

    h.api.script(Operation::Heartbeat, [Answer::ServerError]);
    advance(Duration::from_secs(15)).await;
    until("a 503 is shown", || {
        connectivity(&h) == Some(Connectivity::Unreachable)
    })
    .await;

    advance(Duration::from_secs(15)).await;
    until("connected again", || {
        connectivity(&h) == Some(Connectivity::Connected)
    })
    .await;
    assert_eq!(
        count(&h.api, Operation::Heartbeat),
        3,
        "the 503 and the next beat both reached the API, on schedule"
    );
}
