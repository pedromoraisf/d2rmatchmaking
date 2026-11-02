//! AGS-23: the fake API answers the contract's shapes, rejects bodies that break their schema, answers its script in
//! order and streams events with their ids.

mod support;

use std::time::Duration;

use serde_json::{Value, json};
use support::fake_api::{Answer, FakeApi, Operation};

const AGENT_TOKEN: &str = "Bearer d2rmm_a_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn heartbeat_body() -> Value {
    json!({
        "agentVersion": "0.0.1",
        "pcState": "IDLE",
        "game": { "running": false, "window": "", "screen": "UNKNOWN" },
        "assignment": null,
        "capture": { "method": "none", "readRate": 0 },
    })
}

/// The complete SSE block whose `id:` line is `id`. A block still missing its blank line is not complete yet.
fn event_block(stream_text: &str, id: &str) -> Option<String> {
    let blocks: Vec<&str> = stream_text.split("\n\n").collect();
    let complete = &blocks[..blocks.len().saturating_sub(1)];
    complete
        .iter()
        .find(|block| block.lines().any(|line| line == format!("id: {id}")))
        .map(|block| block.to_string())
}

async fn read_until(response: &mut reqwest::Response, buffer: &mut String, id: &str) {
    while event_block(buffer, id).is_none() {
        let chunk = response
            .chunk()
            .await
            .expect("the stream stays readable")
            .expect("the stream stays open");
        buffer.push_str(&String::from_utf8_lossy(&chunk));
    }
}

#[tokio::test]
async fn a_body_that_breaks_its_schema_is_answered_400_and_logged_invalid() {
    let api = FakeApi::start().await;
    let client = reqwest::Client::new();
    let url = format!("{}/v1/agents/heartbeat", api.base_url());

    let broken = client
        .post(&url)
        .header("x-agent-version", "0.0.1")
        .header("authorization", AGENT_TOKEN)
        .json(&json!({ "agentVersion": "not-a-version" }))
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(broken.status(), 400);

    let valid = client
        .post(&url)
        .header("x-agent-version", "0.0.1")
        .header("authorization", AGENT_TOKEN)
        .json(&heartbeat_body())
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(valid.status(), 204);

    let logged = api.requests();
    assert_eq!(logged.len(), 2, "both requests are logged");
    assert_eq!(logged[0].operation, Operation::Heartbeat);
    assert!(
        logged[0].invalid_body,
        "the broken body is logged as invalid"
    );
    assert_eq!(logged[0].status, 400);
    assert!(
        !logged[1].invalid_body,
        "the valid body is not logged as invalid"
    );
    assert_eq!(logged[1].status, 204);
    assert_eq!(logged[1].header("x-agent-version"), Some("0.0.1"));
    assert_eq!(logged[1].header("authorization"), Some(AGENT_TOKEN));
}

#[tokio::test]
async fn scripted_answers_come_back_in_order() {
    let api = FakeApi::start().await;
    api.script(
        Operation::Heartbeat,
        [Answer::ServerError, Answer::Unauthorized, Answer::Ok],
    );
    api.script(
        Operation::Claim,
        [Answer::Pending, Answer::Gone, Answer::Ok],
    );
    api.script(
        Operation::RequestCode,
        [
            Answer::RateLimited {
                retry_after: Some(120),
            },
            Answer::RateLimited { retry_after: None },
        ],
    );
    let client = reqwest::Client::new();
    let base = api.base_url();

    let mut heartbeat_statuses = Vec::new();
    for _ in 0..4 {
        let response = client
            .post(format!("{base}/v1/agents/heartbeat"))
            .header("x-agent-version", "0.0.1")
            .header("authorization", AGENT_TOKEN)
            .json(&heartbeat_body())
            .send()
            .await
            .expect("the fake answers");
        heartbeat_statuses.push(response.status().as_u16());
    }
    assert_eq!(heartbeat_statuses, vec![503, 401, 204, 204]);

    let claim_body = json!({ "claimSecret": "claim-secret-fake-0001" });
    let mut claim_statuses = Vec::new();
    for _ in 0..4 {
        let response = client
            .post(format!("{base}/v1/agents/pairing-codes/claim"))
            .header("x-agent-version", "0.0.1")
            .json(&claim_body)
            .send()
            .await
            .expect("the fake answers");
        claim_statuses.push(response.status().as_u16());
    }
    assert_eq!(claim_statuses, vec![202, 410, 200, 200]);

    let first_code = client
        .post(format!("{base}/v1/agents/pairing-codes"))
        .header("x-agent-version", "0.0.1")
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(first_code.status(), 429);
    assert_eq!(
        first_code
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok()),
        Some("120")
    );

    let second_code = client
        .post(format!("{base}/v1/agents/pairing-codes"))
        .header("x-agent-version", "0.0.1")
        .send()
        .await
        .expect("the fake answers");
    assert_eq!(second_code.status(), 429);
    assert!(
        second_code.headers().get("retry-after").is_none(),
        "no Retry-After when unscripted"
    );
}

#[tokio::test]
async fn the_stream_sends_events_with_ids() {
    let api = FakeApi::start().await;
    api.push_event(
        "1",
        "room.assigned",
        json!({
            "roomId": "7d9f2c1e-0000-4000-8000-000000000001",
            "run": 1,
            "expectedGameName": "mmbaalh-12",
            "members": [{ "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }],
        }),
    );

    let client = reqwest::Client::new();
    let mut response = client
        .get(format!("{}/v1/stream", api.base_url()))
        .header("authorization", AGENT_TOKEN)
        .header("accept", "text/event-stream")
        .send()
        .await
        .expect("the stream opens");
    assert_eq!(response.status(), 200);

    let mut received = String::new();
    tokio::time::timeout(
        Duration::from_secs(5),
        read_until(&mut response, &mut received, "1"),
    )
    .await
    .expect("the queued event is replayed");
    let replayed = event_block(&received, "1").expect("event 1 arrived");
    assert!(
        replayed.lines().any(|line| line == "event: room.assigned"),
        "event name: {replayed}"
    );
    assert!(
        replayed.lines().any(|line| line.starts_with("data: {")),
        "JSON data: {replayed}"
    );

    api.push_event("2", "agent.presence_changed", json!({ "online": true }));
    tokio::time::timeout(
        Duration::from_secs(5),
        read_until(&mut response, &mut received, "2"),
    )
    .await
    .expect("the live event is streamed");
    let live = event_block(&received, "2").expect("event 2 arrived");
    assert!(
        live.lines()
            .any(|line| line == "event: agent.presence_changed"),
        "event name: {live}"
    );
    assert!(
        live.lines().any(|line| line == "data: {\"online\":true}"),
        "data: {live}"
    );
}
