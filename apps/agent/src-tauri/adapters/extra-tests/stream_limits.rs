//! AHM-22, AGS-15: an invalid body is an invalid error, not a value, and an invalid stream event changes nothing. The tests
//! live in this extra target, not under `tests/`: the preservation guard (T9) keeps the moved tests byte-identical, and new
//! asserting tests are kept out of its set.

#[path = "../tests/support/mod.rs"]
mod support;

use d2rmm_agent_adapters::config::{AllowLoopbackHttp, ApiBase};
use d2rmm_agent_adapters::http::api_client::ApiClient;
use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_core::ports::{ApiError, ApiGateway, StreamItem};
use d2rmm_agent_core::secret::Secret;
use serde_json::json;
use support::fake_api::{FakeApi, TOKEN};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const VERSION: &str = "0.0.1";
const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

fn gateway_at(base: &str) -> HttpGateway {
    let api_base = ApiBase::parse(base, AllowLoopbackHttp::Yes).expect("a loopback base");
    HttpGateway::new(ApiClient::new(VERSION, &api_base, reqwest::Client::new()))
}

/// A 200 answer whose body does not match the assignment contract: `run` is a word, not a number.
#[tokio::test]
async fn invalid_assignment_body_is_an_invalid_error() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind a local port");
    let address = listener.local_addr().expect("local address");
    let body = format!(
        r#"{{"roomId":"{ROOM}","run":"one","expectedGameName":"mmbaalh-12","members":[]}}"#
    );
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut request = [0_u8; 4096];
        let _ = socket.read(&mut request).await;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write the response");
    });

    let gateway = gateway_at(&format!("http://{address}"));
    match gateway.assignment(&Secret::new(TOKEN)).await {
        Err(error) => assert_eq!(error, ApiError::Invalid),
        Ok(_) => panic!("a body that breaks the contract must not read as an assignment"),
    }
}

/// An event whose game name the agent refuses is skipped; the next valid `room.assigned` is the one the stream yields.
#[tokio::test]
async fn invalid_stream_event_is_skipped() {
    let api = FakeApi::start().await;
    api.push_event(
        "1",
        "room.assigned",
        json!({
            "roomId": ROOM,
            "run": 1,
            "expectedGameName": "not a valid name!",
            "members": [],
        }),
    );
    api.push_event(
        "2",
        "room.assigned",
        json!({
            "roomId": ROOM,
            "run": 1,
            "expectedGameName": "mmbaalh-12",
            "members": [],
        }),
    );

    let gateway = gateway_at(&api.base_url());
    let mut stream = gateway
        .open_stream(&Secret::new(TOKEN), None)
        .await
        .expect("the fake opens the stream");
    match stream.next().await {
        StreamItem::RoomAssigned(assignment) => {
            assert_eq!(assignment.expected_game_name.as_str(), "mmbaalh-12");
        }
        StreamItem::Ended(reason) => panic!("the stream ended before the valid event: {reason:?}"),
    }
}
