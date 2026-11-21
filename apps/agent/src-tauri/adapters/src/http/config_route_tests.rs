//! The configuration route of the HTTP client (RCF-04): the agent asks its own API for the configuration with the token, its version and the tag it holds, reads `200`,
//! `304` and `404`, maps every other status to its error, and never reads more than the size limit.

use std::sync::{Arc, Mutex};

use crate::config::{AllowLoopbackHttp, ApiBase};
use crate::http::api_client::{ApiClient, ApiError};
use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use d2rmm_agent_core::ports::Fetched;
use d2rmm_agent_core::secret::Secret;
use tokio::net::TcpListener;

const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

#[derive(Clone, Default)]
struct Served {
    answer: Arc<Mutex<(u16, Vec<u8>)>>,
    seen: Arc<Mutex<Vec<HeaderMap>>>,
    /// Answer in chunks with no declared length, so the client has no `Content-Length` to refuse the body by.
    chunked: Arc<std::sync::atomic::AtomicBool>,
}

async fn config(State(served): State<Served>, headers: HeaderMap) -> Response {
    served.seen.lock().expect("seen").push(headers);
    let (status, body) = served.answer.lock().expect("answer").clone();
    if served.chunked.load(std::sync::atomic::Ordering::SeqCst) {
        let chunks: Vec<Result<Vec<u8>, std::convert::Infallible>> =
            body.chunks(1_000).map(|chunk| Ok(chunk.to_vec())).collect();
        return (
            StatusCode::from_u16(status).expect("a status"),
            axum::body::Body::from_stream(tokio_stream::iter(chunks)),
        )
            .into_response();
    }
    let mut response = (StatusCode::from_u16(status).expect("a status"), body).into_response();
    if status == 200 {
        response
            .headers_mut()
            .insert(header::ETAG, "\"tag-1\"".parse().expect("a tag"));
    }
    response
}

async fn start() -> (ApiClient, Served) {
    let served = Served::default();
    let app = Router::new()
        .route("/v1/agents/config", get(config))
        .with_state(served.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let address = listener.local_addr().expect("an address");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("the server runs");
    });
    let base = ApiBase::parse(&format!("http://{address}"), AllowLoopbackHttp::Yes)
        .expect("a loopback base");
    (
        ApiClient::new("0.0.1", &base, reqwest::Client::new()),
        served,
    )
}

fn answer(served: &Served, status: u16, body: &[u8]) {
    *served.answer.lock().expect("answer") = (status, body.to_vec());
}

#[tokio::test]
async fn a_200_gives_the_body_and_the_tag() {
    let (client, served) = start().await;
    answer(&served, 200, br#"{"version":2}"#);

    let fetched = client.config(&Secret::new(TOKEN), None).await;

    assert_eq!(
        fetched,
        Fetched::Body {
            bytes: br#"{"version":2}"#.to_vec(),
            etag: Some("\"tag-1\"".to_string()),
        }
    );
}

#[tokio::test]
async fn the_request_carries_the_token_the_version_and_the_held_tag_and_nothing_else_of_the_agent()
{
    let (client, served) = start().await;
    answer(&served, 304, b"");

    let first = client.config(&Secret::new(TOKEN), None).await;
    let second = client.config(&Secret::new(TOKEN), Some("\"tag-1\"")).await;

    assert_eq!(first, Fetched::NotModified);
    assert_eq!(second, Fetched::NotModified);
    let seen = served.seen.lock().expect("seen");
    assert!(
        seen[0].get(header::IF_NONE_MATCH).is_none(),
        "no tag held, none sent"
    );
    assert_eq!(
        seen[1].get(header::IF_NONE_MATCH).expect("a tag"),
        "\"tag-1\""
    );
    for headers in seen.iter() {
        assert_eq!(
            headers.get(header::AUTHORIZATION).expect("a token"),
            format!("Bearer {TOKEN}").as_str()
        );
        assert_eq!(headers.get("x-agent-version").expect("a version"), "0.0.1");
        assert!(headers.get(header::COOKIE).is_none());
    }
}

#[tokio::test]
async fn a_404_means_the_api_serves_none() {
    let (client, served) = start().await;
    answer(&served, 404, b"");
    assert_eq!(
        client.config(&Secret::new(TOKEN), None).await,
        Fetched::Absent
    );
}

#[tokio::test]
async fn every_other_status_is_its_error() {
    let (client, served) = start().await;
    for (status, error) in [
        (401, ApiError::Unauthorized),
        (426, ApiError::UpgradeRequired),
        (500, ApiError::Server),
        (503, ApiError::Server),
        (400, ApiError::Invalid),
        (204, ApiError::Invalid),
    ] {
        answer(&served, status, b"");
        assert_eq!(
            client.config(&Secret::new(TOKEN), None).await,
            Fetched::Failed(error),
            "{status}"
        );
    }
}

#[tokio::test]
async fn a_body_over_the_limit_is_cut_one_byte_past_it() {
    let (client, served) = start().await;
    answer(&served, 200, &vec![b'a'; 1_000_000]);

    let Fetched::Body { bytes, .. } = client.config(&Secret::new(TOKEN), None).await else {
        panic!("a body");
    };

    assert_eq!(
        bytes.len(),
        65_537,
        "never more than the limit and one byte"
    );
}

#[tokio::test]
async fn a_body_at_the_limit_is_read_whole() {
    let (client, served) = start().await;
    answer(&served, 200, &vec![b'a'; 65_536]);

    let Fetched::Body { bytes, .. } = client.config(&Secret::new(TOKEN), None).await else {
        panic!("a body");
    };

    assert_eq!(bytes.len(), 65_536);
}

#[tokio::test]
async fn an_unreachable_api_is_a_network_failure() {
    let base = ApiBase::parse("http://127.0.0.1:1", AllowLoopbackHttp::Yes).expect("a base");
    let client = ApiClient::new("0.0.1", &base, reqwest::Client::new());
    assert_eq!(
        client.config(&Secret::new(TOKEN), None).await,
        Fetched::Failed(ApiError::Network)
    );
}

#[tokio::test]
async fn a_declared_length_over_the_limit_is_refused_before_the_body_is_read() {
    let (client, served) = start().await;
    answer(&served, 200, &vec![b'a'; 1_000_000]);

    let Fetched::Body { bytes, .. } = client.config(&Secret::new(TOKEN), None).await else {
        panic!("a body");
    };

    assert_eq!(bytes.len(), 65_537);
    assert!(
        bytes.iter().all(|byte| *byte == 0),
        "nothing of the body was read"
    );
}

#[tokio::test]
async fn a_streamed_body_over_the_limit_is_cut_one_byte_past_it() {
    let (client, served) = start().await;
    served
        .chunked
        .store(true, std::sync::atomic::Ordering::SeqCst);
    answer(&served, 200, &vec![b'a'; 1_000_000]);

    let Fetched::Body { bytes, .. } = client.config(&Secret::new(TOKEN), None).await else {
        panic!("a body");
    };

    assert_eq!(bytes.len(), 65_537);
    assert!(
        bytes.iter().all(|byte| *byte == b'a'),
        "read from the stream, up to the cut"
    );
}

#[tokio::test]
async fn a_streamed_body_at_the_limit_is_read_whole() {
    let (client, served) = start().await;
    served
        .chunked
        .store(true, std::sync::atomic::Ordering::SeqCst);
    answer(&served, 200, &vec![b'a'; 65_536]);

    let Fetched::Body { bytes, .. } = client.config(&Secret::new(TOKEN), None).await else {
        panic!("a body");
    };

    assert_eq!(bytes.len(), 65_536);
}
