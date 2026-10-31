//! AGS-13 to AGS-15: the assignment is fetched before the stream opens, reconnects back off from 1 s to 60 s, the latest
//! `room.assigned` wins, and unknown or invalid events leave the state unchanged.

mod support;

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_core::stream;
use serde_json::{Value, json};
use support::fake_api::{Answer, Operation, TOKEN};
use support::harness::{Harness, advance, count, settle, until};

const ROOM_A: &str = "7d9f2c1e-0000-4000-8000-000000000001";
const ROOM_B: &str = "7d9f2c1e-0000-4000-8000-000000000002";

fn assigned(game_name: &str, room: &str) -> Value {
    json!({
        "roomId": room,
        "run": 1,
        "expectedGameName": game_name,
        "members": [{ "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }],
    })
}

fn spawn_stream(h: &Harness) {
    tokio::spawn(stream::run(Arc::clone(&h.ctx)));
}

/// The expected game name of the current assignment.
fn expected_name(h: &Harness) -> Option<String> {
    h.ctx
        .assignment
        .borrow()
        .as_ref()
        .map(|assignment| assignment.expected_game_name.as_str().to_string())
}

/// The game name the window shows for the current room.
fn shown_room(h: &Harness) -> Option<String> {
    h.sink
        .last()
        .and_then(|view| view.room)
        .map(|room| room.game_name)
}

#[tokio::test(start_paused = true)]
async fn fetches_assignment_then_streams() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    spawn_stream(&h);
    until("the stream is open", || {
        count(&h.api, Operation::Stream) == 1
    })
    .await;

    let requests = h.api.requests();
    let assignment = requests
        .iter()
        .position(|request| request.operation == Operation::Assignment)
        .expect("the assignment was fetched");
    let stream = requests
        .iter()
        .position(|request| request.operation == Operation::Stream)
        .expect("the stream was opened");
    assert!(
        assignment < stream,
        "the assignment comes before the stream"
    );

    let bearer = format!("Bearer {TOKEN}");
    assert_eq!(
        requests[stream].header("authorization"),
        Some(bearer.as_str())
    );
    assert_eq!(
        requests[stream].header("last-event-id"),
        None,
        "no Last-Event-ID before an event was received"
    );
    assert_eq!(expected_name(&h).as_deref(), Some("mmbaalh-12"));
}

#[tokio::test(start_paused = true)]
async fn reconnect_backoff_doubles_to_60s() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api
        .script(Operation::Stream, vec![Answer::ServerError; 8]);
    spawn_stream(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Stream) == 1
    })
    .await;
    settle().await;

    // The delay after the k-th failure is 1, 2, 4, 8, 16, 32, then 60 s and 60 s again (AD-059).
    for (failures, delay_s) in [1u64, 2, 4, 8, 16, 32, 60, 60].into_iter().enumerate() {
        let attempts = failures + 1;
        advance(Duration::from_millis(delay_s * 1000 - 100)).await;
        assert_eq!(
            count(&h.api, Operation::Stream),
            attempts,
            "no reconnect before {delay_s} s"
        );
        advance(Duration::from_millis(100)).await;
        until("the reconnect", || {
            count(&h.api, Operation::Stream) == attempts + 1
        })
        .await;
        settle().await;
    }
}

#[tokio::test(start_paused = true)]
async fn latest_room_assigned_wins() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api
        .push_event("1", "room.assigned", assigned("mmbaalh-12", ROOM_A));
    h.api
        .push_event("2", "room.assigned", assigned("mmbaalh-13", ROOM_B));
    spawn_stream(&h);

    until("the latest assignment", || {
        expected_name(&h).as_deref() == Some("mmbaalh-13")
    })
    .await;
    assert_eq!(
        shown_room(&h).as_deref(),
        Some("mmbaalh-13"),
        "the window shows the latest room"
    );
}

#[tokio::test(start_paused = true)]
async fn unknown_or_invalid_events_are_ignored() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);

    // Each of these would change the assignment to mmbaalh-13 if it were accepted, except the last two.
    let mut extra_field = assigned("mmbaalh-13", ROOM_B);
    extra_field["unexpected"] = json!(1);
    h.api.push_event("1", "room.assigned", extra_field);
    h.api
        .push_event("2", "agent.presence_changed", json!({ "online": true }));
    h.api.push_event(
        "3",
        "room.assigned",
        assigned(&format!("mmbaalh-{}", "1".repeat(25)), ROOM_B),
    );
    h.api
        .push_event("4", "room.assigned", assigned("mmbaalh-13", "not-a-uuid"));
    // Over 64 KiB: the reader closes the connection instead of parsing it.
    let mut oversized = assigned("mmbaalh-13", ROOM_B);
    oversized["padding"] = json!("x".repeat(65_537));
    h.api.push_event("5", "room.assigned", oversized);
    spawn_stream(&h);

    until("the first stream", || count(&h.api, Operation::Stream) == 1).await;
    settle().await;
    advance(Duration::from_secs(1)).await;
    until("the reconnect after the oversized event", || {
        count(&h.api, Operation::Stream) == 2
    })
    .await;

    assert_eq!(
        expected_name(&h).as_deref(),
        Some("mmbaalh-12"),
        "no invalid or unknown event changed the assignment"
    );
    assert_eq!(shown_room(&h).as_deref(), Some("mmbaalh-12"));
}
