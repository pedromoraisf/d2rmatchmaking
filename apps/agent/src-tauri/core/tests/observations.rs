//! AGS-19: observation posts are retried at 1, 2, 4 and 8 s with the same idempotency key, a 401 or a 426 drops the
//! pending retries, a 4xx answer is never retried, and an assignment change keeps them.

mod support;

use std::time::Duration;

use d2rmm_agent_core::contracts::generated::Observation;
use d2rmm_agent_core::gateway::translate::assignment_from_contract;
use d2rmm_agent_core::messages::Assignment;
use d2rmm_agent_core::observations::{self, SendOutcome};
use serde_json::{Value, json};
use support::fake_api::{Answer, Operation, TOKEN};
use support::harness::{Harness, advance, count, settle, until};

const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";
const KEY: &str = "5b1e6d2a-0000-4000-8000-00000000abcd";

fn observation() -> Observation {
    serde_json::from_value(json!({
        "idempotencyKey": KEY,
        "type": "GAME_NAME_SEEN",
        "run": 1,
        "value": "mmbaalh-12",
        "confidence": 0.93,
        "capturedAt": "2026-10-31T10:00:00Z",
    }))
    .expect("a contract observation")
}

fn assignment() -> Assignment {
    let contract: d2rmm_agent_core::contracts::generated::Assignment = serde_json::from_value(json!({
        "roomId": ROOM,
        "run": 1,
        "expectedGameName": "mmbaalh-12",
        "members": [{ "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }],
    }))
    .expect("a contract assignment");
    assignment_from_contract(contract)
}

fn posted_bodies(h: &Harness) -> Vec<Value> {
    h.api
        .requests()
        .into_iter()
        .filter(|request| request.operation == Operation::Observation)
        .filter_map(|request| request.body)
        .collect()
}

fn spawn_send(h: &Harness) -> tokio::task::JoinHandle<SendOutcome> {
    let ctx = std::sync::Arc::clone(&h.ctx);
    tokio::spawn(async move {
        let observation = observation();
        observations::send(&ctx, ROOM.parse().expect("a UUID room"), &observation).await
    })
}

#[tokio::test(start_paused = true)]
async fn retries_with_same_key_at_1_2_4_8() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api
        .script(Operation::Observation, vec![Answer::ServerError; 5]);
    let send = spawn_send(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;
    settle().await;

    for (attempts, delay_s) in [(1usize, 1u64), (2, 2), (3, 4), (4, 8)] {
        advance(Duration::from_millis(delay_s * 1000 - 100)).await;
        assert_eq!(
            count(&h.api, Operation::Observation),
            attempts,
            "no retry before {delay_s} s"
        );
        advance(Duration::from_millis(100)).await;
        until("the retry", || {
            count(&h.api, Operation::Observation) == attempts + 1
        })
        .await;
        settle().await;
    }

    // The fifth attempt, at 15 s, fails too: the observation is dropped and counted.
    until("the send ends", || send.is_finished()).await;
    assert_eq!(
        send.await.expect("the send task ends"),
        SendOutcome::Dropped
    );
    assert_eq!(
        count(&h.api, Operation::Observation),
        5,
        "five attempts in all"
    );
    assert_eq!(h.ctx.dropped_observations(), 1);

    let keys: Vec<Value> = posted_bodies(&h)
        .iter()
        .map(|body| body["idempotencyKey"].clone())
        .collect();
    assert_eq!(keys.len(), 5);
    assert!(
        keys.iter().all(|key| key == KEY),
        "every attempt reuses the key"
    );
}

#[tokio::test(start_paused = true)]
async fn unauthorized_drops_pending_retries() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api.script(
        Operation::Observation,
        [Answer::ServerError, Answer::Unauthorized],
    );
    let send = spawn_send(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;
    settle().await;

    advance(Duration::from_secs(1)).await;
    until("the send ends", || send.is_finished()).await;
    assert_eq!(
        send.await.expect("the send task ends"),
        SendOutcome::Dropped
    );

    advance(Duration::from_secs(60)).await;
    assert_eq!(
        count(&h.api, Operation::Observation),
        2,
        "no retry after a 401"
    );
    assert!(h.tokens.stored().is_none(), "the 401 deleted the token");
    assert_eq!(h.ctx.dropped_observations(), 1);
}

#[tokio::test(start_paused = true)]
async fn upgrade_required_drops_pending_retries() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api.script(
        Operation::Observation,
        [Answer::ServerError, Answer::UpgradeRequired],
    );
    let send = spawn_send(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;
    settle().await;

    advance(Duration::from_secs(1)).await;
    until("the send ends", || send.is_finished()).await;
    assert_eq!(
        send.await.expect("the send task ends"),
        SendOutcome::Dropped
    );

    advance(Duration::from_secs(60)).await;
    assert_eq!(
        count(&h.api, Operation::Observation),
        2,
        "no retry after a 426"
    );
    assert!(
        *h.ctx.update_required.borrow(),
        "the 426 closed the API gate"
    );
}

#[tokio::test(start_paused = true)]
async fn observation_4xx_is_not_retried() {
    // A client error is the observation's own fault: it is dropped at once, never posted again (AD-051).
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api.script(Operation::Observation, [Answer::BadRequest]);
    let send = spawn_send(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;
    until("the send ends", || send.is_finished()).await;
    assert_eq!(
        send.await.expect("the send task ends"),
        SendOutcome::Dropped
    );

    advance(Duration::from_secs(60)).await;
    assert_eq!(
        count(&h.api, Operation::Observation),
        1,
        "a 4xx answer is not retried"
    );
    assert_eq!(h.ctx.dropped_observations(), 1);
}

#[tokio::test(start_paused = true)]
async fn assignment_change_keeps_pending_retries() {
    let h = Harness::start(Some(TOKEN)).await;
    h.ctx.paired.send_replace(true);
    h.api.script(
        Operation::Observation,
        [Answer::ServerError, Answer::ServerError, Answer::Ok],
    );
    let send = spawn_send(&h);
    until("the first attempt", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;
    settle().await;

    h.ctx.assignment.send_replace(Some(assignment()));
    advance(Duration::from_secs(1)).await;
    until("the retry", || count(&h.api, Operation::Observation) == 2).await;
    settle().await;
    advance(Duration::from_secs(2)).await;
    until("the send ends", || send.is_finished()).await;

    assert_eq!(send.await.expect("the send task ends"), SendOutcome::Posted);
    assert_eq!(count(&h.api, Operation::Observation), 3);
    assert_eq!(h.ctx.dropped_observations(), 0);
}
