//! AGS-12, AGS-23, AGS-35: the client sends the version and a traceparent with every request, maps each status to its
//! error, clamps Retry-After and sends only the contract's request types.

mod support;

use std::sync::Once;
use std::time::Duration;

use d2rmm_agent_core::api_client::{ApiClient, ApiError};
use d2rmm_agent_core::config::{AllowLoopbackHttp, ApiBase, Config};
use d2rmm_agent_core::contracts::generated::{ClaimRequest, Heartbeat, Observation};
use d2rmm_agent_core::secret::Secret;
use d2rmm_agent_core::telemetry::{Mode, init};
use serde_json::{Value, json};
use support::fake_api::{Answer, CLAIM_SECRET, FakeApi, Operation, TOKEN};
use uuid::Uuid;

const VERSION: &str = "0.0.1";
const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

fn install_telemetry() {
    static INIT: Once = Once::new();
    INIT.call_once(|| init(Mode::Test).expect("the test subscriber installs once"));
}

async fn client_for(api: &FakeApi) -> ApiClient {
    install_telemetry();
    let api_base =
        ApiBase::parse(&api.base_url(), AllowLoopbackHttp::Yes).expect("the fake's loopback base");
    let config = Config {
        version: VERSION.to_string(),
        api_base,
    };
    ApiClient::new(&config, reqwest::Client::new())
}

fn token() -> Secret {
    Secret::new(TOKEN)
}

fn room() -> Uuid {
    ROOM.parse().expect("a UUID room id")
}

fn heartbeat_json() -> Value {
    json!({
        "agentVersion": VERSION,
        "pcState": "IDLE",
        "game": { "running": true, "window": "", "screen": "UNKNOWN" },
        "assignment": null,
        "capture": { "method": "none", "readRate": 0 },
    })
}

fn heartbeat() -> Heartbeat {
    serde_json::from_value(heartbeat_json()).expect("the heartbeat fixture is a contract value")
}

fn observation_json() -> Value {
    json!({
        "idempotencyKey": "key-1",
        "type": "GAME_NAME_SEEN",
        "run": 1,
        "value": "mmbaalh-12",
        "confidence": 0.93,
        "capturedAt": "2026-10-31T10:00:00Z",
    })
}

fn observation() -> Observation {
    serde_json::from_value(observation_json()).expect("the observation fixture is a contract value")
}

/// A W3C traceparent: version 00, a non-zero 32-hex trace id, a non-zero 16-hex span id and two hex flags.
fn assert_traceparent(value: &str) {
    let parts: Vec<&str> = value.split('-').collect();
    assert_eq!(parts.len(), 4, "traceparent has four fields: {value}");
    assert_eq!(parts[0], "00");
    assert!(
        parts[1].len() == 32
            && parts[1].chars().all(|c| c.is_ascii_hexdigit())
            && parts[1] != "0".repeat(32)
    );
    assert!(
        parts[2].len() == 16
            && parts[2].chars().all(|c| c.is_ascii_hexdigit())
            && parts[2] != "0".repeat(16)
    );
    assert!(parts[3].len() == 2 && parts[3].chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn every_request_carries_version_and_traceparent() {
    let api = FakeApi::start().await;
    let client = client_for(&api).await;

    client.request_code().await.expect("the code is issued");
    client
        .claim(&Secret::new(CLAIM_SECRET))
        .await
        .expect("the claim returns the token");
    client
        .heartbeat(&token(), &heartbeat())
        .await
        .expect("the heartbeat is accepted");
    client
        .assignment(&token())
        .await
        .expect("the assignment is read");
    client
        .post_observation(&token(), room(), &observation())
        .await
        .expect("the observation is stored");
    let _stream = client
        .open_stream(&token(), None)
        .await
        .expect("the stream opens");

    let logged = api.requests();
    let operations: Vec<Operation> = logged.iter().map(|request| request.operation).collect();
    assert_eq!(
        operations,
        vec![
            Operation::RequestCode,
            Operation::Claim,
            Operation::Heartbeat,
            Operation::Assignment,
            Operation::Observation,
            Operation::Stream,
        ]
    );
    for request in &logged {
        assert_eq!(
            request.header("x-agent-version"),
            Some(VERSION),
            "version on {:?}",
            request.operation
        );
        assert_traceparent(
            request
                .header("traceparent")
                .expect("a traceparent on every request"),
        );
    }
}

#[tokio::test]
async fn each_status_maps_to_its_api_error() {
    let api = FakeApi::start().await;
    let client = client_for(&api).await;

    api.script(
        Operation::RequestCode,
        [
            Answer::RateLimited {
                retry_after: Some(120),
            },
            Answer::UpgradeRequired,
        ],
    );
    assert_eq!(
        client.request_code().await.err(),
        Some(ApiError::RateLimited {
            retry_after: Some(Duration::from_secs(120)),
        })
    );
    assert_eq!(
        client.request_code().await.err(),
        Some(ApiError::UpgradeRequired)
    );

    api.script(Operation::Claim, [Answer::Pending, Answer::Gone]);
    assert_eq!(
        client.claim(&Secret::new(CLAIM_SECRET)).await.err(),
        Some(ApiError::Pending)
    );
    assert_eq!(
        client.claim(&Secret::new(CLAIM_SECRET)).await.err(),
        Some(ApiError::Gone)
    );

    api.script(
        Operation::Heartbeat,
        [Answer::Unauthorized, Answer::ServerError],
    );
    assert_eq!(
        client.heartbeat(&token(), &heartbeat()).await,
        Err(ApiError::Unauthorized)
    );
    assert_eq!(
        client.heartbeat(&token(), &heartbeat()).await,
        Err(ApiError::Server)
    );

    api.script(
        Operation::Assignment,
        [Answer::NoAssignment, Answer::ServerError],
    );
    let no_room = client
        .assignment(&token())
        .await
        .expect("a 404 means no assignment, not an error");
    assert!(no_room.is_none(), "a 404 yields no assignment");
    assert_eq!(
        client.assignment(&token()).await.err(),
        Some(ApiError::Server)
    );

    api.script(Operation::Observation, [Answer::ServerError]);
    assert_eq!(
        client
            .post_observation(&token(), room(), &observation())
            .await,
        Err(ApiError::Server)
    );

    api.script(Operation::Stream, [Answer::Unauthorized]);
    assert_eq!(
        client.open_stream(&token(), None).await.err(),
        Some(ApiError::Unauthorized)
    );

    api.refuse_connections().await;
    assert_eq!(
        client.heartbeat(&token(), &heartbeat()).await,
        Err(ApiError::Network)
    );
}

#[tokio::test]
async fn retry_after_is_clamped() {
    let api = FakeApi::start().await;
    let client = client_for(&api).await;
    api.script(
        Operation::RequestCode,
        [
            Answer::RateLimited {
                retry_after: Some(0),
            },
            Answer::RateLimited {
                retry_after: Some(999_999),
            },
        ],
    );

    assert_eq!(
        client.request_code().await.err(),
        Some(ApiError::RateLimited {
            retry_after: Some(Duration::from_secs(1)),
        })
    );
    assert_eq!(
        client.request_code().await.err(),
        Some(ApiError::RateLimited {
            retry_after: Some(Duration::from_secs(60 * 60)),
        })
    );
}

#[tokio::test]
async fn sends_only_contract_request_types() {
    let api = FakeApi::start().await;
    let client = client_for(&api).await;

    let claim_request = ClaimRequest {
        claim_secret: Secret::new(CLAIM_SECRET),
    };
    let heartbeat_request = heartbeat();
    let observation_request = observation();

    client.request_code().await.expect("the code is issued");
    client
        .claim(&claim_request.claim_secret)
        .await
        .expect("the claim returns the token");
    client
        .heartbeat(&token(), &heartbeat_request)
        .await
        .expect("the heartbeat is accepted");
    client
        .post_observation(&token(), room(), &observation_request)
        .await
        .expect("the observation is stored");

    let logged = api.requests();
    assert!(
        logged.iter().all(|request| !request.invalid_body),
        "every body passes its schema"
    );

    let with_body: Vec<(Operation, Value)> = logged
        .iter()
        .filter_map(|request| request.body.clone().map(|body| (request.operation, body)))
        .collect();
    let operations: Vec<Operation> = with_body.iter().map(|(operation, _)| *operation).collect();
    assert_eq!(
        operations,
        vec![
            Operation::Claim,
            Operation::Heartbeat,
            Operation::Observation
        ],
        "only the claim, heartbeat and observation carry a body"
    );

    assert_eq!(
        with_body[0].1,
        serde_json::to_value(&claim_request).expect("the claim request serializes")
    );
    assert_eq!(
        with_body[1].1,
        serde_json::to_value(&heartbeat_request).expect("the heartbeat serializes")
    );
    assert_eq!(
        with_body[2].1,
        serde_json::to_value(&observation_request).expect("the observation serializes")
    );
}
