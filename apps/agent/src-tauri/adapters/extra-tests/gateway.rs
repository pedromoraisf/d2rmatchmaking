//! AHM-16, AGS-12, AGS-23: the HTTP gateway forwards each agent route to the unchanged client and hands the answer back
//! through the port. The test lives in this extra target, not under `tests/`: the preservation guard (T9) keeps the moved
//! tests byte-identical, and new asserting tests are kept out of its set. The fake API is the one the moved tests use.

#[path = "../../core/tests/support/mod.rs"]
mod support;

use std::num::NonZeroU64;

use chrono::{DateTime, Utc};
use d2rmm_agent_adapters::config::{AllowLoopbackHttp, ApiBase};
use d2rmm_agent_adapters::http::api_client::ApiClient;
use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_core::messages::{GameNameObservation, Presence, Screen};
use d2rmm_agent_core::ports::ApiGateway;
use d2rmm_agent_core::secret::Secret;
use support::fake_api::{CLAIM_SECRET, CODE, FakeApi, Operation, TOKEN};
use uuid::Uuid;

const VERSION: &str = "0.0.1";
const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

async fn gateway_for(api: &FakeApi) -> HttpGateway {
    let api_base =
        ApiBase::parse(&api.base_url(), AllowLoopbackHttp::Yes).expect("the fake's loopback base");
    HttpGateway::new(ApiClient::new(VERSION, &api_base, reqwest::Client::new()))
}

fn observation() -> GameNameObservation {
    GameNameObservation {
        room: ROOM.parse::<Uuid>().expect("a UUID room id"),
        run: NonZeroU64::new(1).expect("a non-zero run"),
        key: Uuid::from_u128(1),
        game_name: "mmbaalh-12".to_string(),
        confidence: 0.93,
        captured_at: "2026-10-31T10:00:00Z"
            .parse::<DateTime<Utc>>()
            .expect("a valid instant"),
    }
}

#[tokio::test]
async fn http_gateway_forwards_each_route() {
    let api = FakeApi::start().await;
    let gateway = gateway_for(&api).await;
    let token = Secret::new(TOKEN);
    let presence = Presence {
        game_running: true,
        screen: Screen::AutomapOpen,
    };

    let issued = gateway
        .request_code()
        .await
        .expect("the fake issues a code");
    assert_eq!(issued.code.as_str(), CODE);
    assert_eq!(issued.claim_secret.expose(), CLAIM_SECRET);

    let claimed = gateway
        .claim(&issued.claim_secret)
        .await
        .expect("the fake hands out a token");
    assert_eq!(claimed.expose(), TOKEN);

    gateway
        .heartbeat(&token, &presence, VERSION)
        .await
        .expect("the fake accepts the heartbeat");

    let assignment = gateway
        .assignment(&token)
        .await
        .expect("the fake answers the assignment")
        .expect("the fake holds an assignment");
    assert_eq!(assignment.room.as_str(), ROOM);
    assert_eq!(assignment.run.get(), 1);
    assert_eq!(assignment.expected_game_name.as_str(), "mmbaalh-12");

    gateway
        .post_observation(&token, &observation())
        .await
        .expect("the fake stores the observation");

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
        ]
    );
    let bearer = format!("Bearer {TOKEN}");
    for request in &logged {
        assert_eq!(request.header("x-agent-version"), Some(VERSION));
    }
    assert_eq!(logged[2].header("authorization"), Some(bearer.as_str()));
    assert_eq!(logged[3].header("authorization"), Some(bearer.as_str()));
    assert_eq!(logged[4].header("authorization"), Some(bearer.as_str()));
    let claim_body = logged[1].body.as_ref().expect("a claim body");
    assert_eq!(claim_body["claimSecret"], CLAIM_SECRET);
    let heartbeat_body = logged[2].body.as_ref().expect("a heartbeat body");
    assert_eq!(heartbeat_body["game"]["screen"], "AUTOMAP_OPEN");
    assert_eq!(heartbeat_body["game"]["running"], true);
    assert_eq!(
        logged[4].path,
        format!("/v1/lobby-rooms/{ROOM}/observations")
    );
    let observation_body = logged[4].body.as_ref().expect("an observation body");
    assert_eq!(observation_body["type"], "GAME_NAME_SEEN");
    assert_eq!(observation_body["value"], "mmbaalh-12");
}
