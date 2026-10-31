//! The fake API (AGS-23): an in-memory server with the agent routes and the stream of `api-web-skeleton`. It validates
//! every request body against its JSON Schema (a broken body is answered 400 and logged invalid), answers scripted
//! outcomes in order, streams queued events with their ids and logs every request with its headers.

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::{Extension, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use chrono::{DateTime, TimeDelta, Utc};
use jsonschema::Validator;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{StreamExt, iter};

/// The routes the agent calls, one per contract exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Operation {
    RequestCode,
    Claim,
    Heartbeat,
    Assignment,
    Observation,
    Stream,
}

/// A scripted outcome. Each route answers its script in order and then answers `Ok` (its success shape).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// The route's success: 201 code, 200 token, 204 heartbeat, 200 assignment, 202 observation, 200 stream.
    Ok,
    /// 202 `{"status":"pending"}` on the claim.
    Pending,
    /// 410 `{"error":"gone"}` on the claim.
    Gone,
    /// 429 `{"error":"rate-limited"}`, with `Retry-After` in seconds when `Some`.
    RateLimited { retry_after: Option<u64> },
    /// 401 `{"error":"unauthenticated"}`.
    Unauthorized,
    /// 426 `{"error":"upgrade-required"}`.
    UpgradeRequired,
    /// 503 `{"error":"unavailable"}`.
    ServerError,
    /// 404 `{"error":"no-assignment"}` on the assignment route.
    NoAssignment,
}

/// One request as the fake saw it. Header names are lower case.
#[derive(Debug, Clone, PartialEq)]
pub struct Logged {
    pub operation: Operation,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Value>,
    pub status: u16,
    pub invalid_body: bool,
}

impl Logged {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// One stream event: the SSE `id`, the `event` name and the JSON `data` the API writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamEvent {
    pub id: String,
    pub name: String,
    pub data: String,
}

pub const CODE: &str = "123456";
/// The wall time at the fake's start. A code issued later expires `CODE_LIFETIME` after its issue time, as the real API
/// does, measured on the tokio clock so that a paused test clock moves it too.
pub const WALL_START: &str = "2026-10-31T10:00:00Z";
pub const CODE_LIFETIME: Duration = Duration::from_secs(5 * 60);
pub const CLAIM_SECRET: &str = "claim-secret-fake-0001";
pub const TOKEN: &str = "d2rmm_a_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const MAX_BODY_BYTES: usize = 64 * 1024;
const LIVE_EVENTS_BUFFER: usize = 64;

fn assignment_payload() -> Value {
    json!({
        "roomId": "7d9f2c1e-0000-4000-8000-000000000001",
        "run": 1,
        "expectedGameName": "mmbaalh-12",
        "members": [
            { "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }
        ],
    })
}

pub struct FakeApi {
    addr: SocketAddr,
    shared: Arc<Shared>,
    listening: tokio::sync::Mutex<Option<(oneshot::Sender<()>, JoinHandle<()>)>>,
}

impl FakeApi {
    /// Starts the fake on a free port of 127.0.0.1.
    pub async fn start() -> Self {
        let shared = Arc::new(Shared::new());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a free loopback port");
        let addr = listener.local_addr().expect("the bound address");
        let listening = serve(listener, Arc::clone(&shared));
        Self {
            addr,
            shared,
            listening: tokio::sync::Mutex::new(Some(listening)),
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Queues answers for `operation`; each request consumes the next one.
    pub fn script(&self, operation: Operation, answers: impl IntoIterator<Item = Answer>) {
        lock(&self.shared.script)
            .entry(operation)
            .or_default()
            .extend(answers);
    }

    /// Every request received so far, in arrival order.
    pub fn requests(&self) -> Vec<Logged> {
        lock(&self.shared.log).clone()
    }

    /// Adds a stream event. Open streams receive it at once; new streams replay it after their `Last-Event-ID`.
    pub fn push_event(&self, id: &str, name: &str, data: Value) {
        let event = StreamEvent {
            id: id.to_string(),
            name: name.to_string(),
            data: data.to_string(),
        };
        let mut events = lock(&self.shared.events);
        events.push(event.clone());
        // Sent while the log is locked, so a stream that subscribes now neither misses nor repeats the event.
        let _ = self.shared.live.send(event);
    }

    /// Stops listening: clients get connection refused until `accept_connections`.
    pub async fn refuse_connections(&self) {
        let taken = self.listening.lock().await.take();
        if let Some((stop, task)) = taken {
            let _ = stop.send(());
            let _ = task.await;
        }
    }

    /// Listens again on the same address.
    pub async fn accept_connections(&self) {
        let mut listening = self.listening.lock().await;
        if listening.is_none() {
            let listener = TcpListener::bind(self.addr)
                .await
                .expect("the fake's port is free again");
            *listening = Some(serve(listener, Arc::clone(&self.shared)));
        }
    }
}

struct Shared {
    started: tokio::time::Instant,
    script: Mutex<HashMap<Operation, VecDeque<Answer>>>,
    log: Mutex<Vec<Logged>>,
    events: Mutex<Vec<StreamEvent>>,
    live: broadcast::Sender<StreamEvent>,
    heartbeat: Validator,
    claim: Validator,
    observation: Validator,
}

impl Shared {
    fn new() -> Self {
        let (live, _) = broadcast::channel(LIVE_EVENTS_BUFFER);
        Self {
            started: tokio::time::Instant::now(),
            script: Mutex::new(HashMap::new()),
            log: Mutex::new(Vec::new()),
            events: Mutex::new(Vec::new()),
            live,
            heartbeat: schema_validator("heartbeat.json"),
            claim: schema_validator("claim-request.json"),
            observation: schema_validator("observation.json"),
        }
    }

    fn next_answer(&self, operation: Operation) -> Answer {
        lock(&self.script)
            .get_mut(&operation)
            .and_then(VecDeque::pop_front)
            .unwrap_or(Answer::Ok)
    }

    fn validator_for(&self, operation: Operation) -> Option<&Validator> {
        match operation {
            Operation::Heartbeat => Some(&self.heartbeat),
            Operation::Claim => Some(&self.claim),
            Operation::Observation => Some(&self.observation),
            _ => None,
        }
    }

    fn subscribe(
        &self,
        last_event_id: Option<&str>,
    ) -> (Vec<StreamEvent>, broadcast::Receiver<StreamEvent>) {
        let events = lock(&self.events);
        let start = last_event_id
            .and_then(|id| {
                events
                    .iter()
                    .position(|event| event.id == id)
                    .map(|index| index + 1)
            })
            .unwrap_or(0);
        (events[start..].to_vec(), self.live.subscribe())
    }
}

fn schema_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../packages/contracts/json-schema")
}

fn schema_validator(file: &str) -> Validator {
    let text =
        std::fs::read_to_string(schema_dir().join(file)).expect("the agent schema is readable");
    let schema: Value = serde_json::from_str(&text).expect("the agent schema is JSON");
    jsonschema::validator_for(&schema).expect("the agent schema compiles")
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

fn serve(listener: TcpListener, shared: Arc<Shared>) -> (oneshot::Sender<()>, JoinHandle<()>) {
    let (stop, stopped) = oneshot::channel::<()>();
    let router = Router::new()
        .route("/v1/agents/pairing-codes", post(request_code))
        .route("/v1/agents/pairing-codes/claim", post(claim))
        .route("/v1/agents/heartbeat", post(heartbeat))
        .route("/v1/agents/me/assignment", get(assignment))
        .route("/v1/lobby-rooms/{id}/observations", post(observation))
        .route("/v1/stream", get(stream))
        .layer(middleware::from_fn_with_state(Arc::clone(&shared), observe))
        .with_state(shared);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = stopped.await;
            })
            .await;
    });
    (stop, task)
}

fn operation_of(method: &Method, path: &str) -> Option<Operation> {
    match (method, path) {
        (&Method::POST, "/v1/agents/pairing-codes") => Some(Operation::RequestCode),
        (&Method::POST, "/v1/agents/pairing-codes/claim") => Some(Operation::Claim),
        (&Method::POST, "/v1/agents/heartbeat") => Some(Operation::Heartbeat),
        (&Method::GET, "/v1/agents/me/assignment") => Some(Operation::Assignment),
        (&Method::GET, "/v1/stream") => Some(Operation::Stream),
        (&Method::POST, _)
            if path.starts_with("/v1/lobby-rooms/") && path.ends_with("/observations") =>
        {
            Some(Operation::Observation)
        }
        _ => None,
    }
}

fn error(status: u16, code: &str) -> Response {
    let status = StatusCode::from_u16(status).expect("a valid status");
    (status, Json(json!({ "error": code }))).into_response()
}

/// Answers the scripted failures every route shares. `None` leaves the route's own success or shape to the handler.
fn scripted_failure(answer: &Answer) -> Option<Response> {
    match answer {
        Answer::RateLimited { retry_after } => {
            let mut response = error(429, "rate-limited");
            if let Some(seconds) = retry_after {
                let value =
                    HeaderValue::from_str(&seconds.to_string()).expect("digits are a header value");
                response.headers_mut().insert(header::RETRY_AFTER, value);
            }
            Some(response)
        }
        Answer::Unauthorized => Some(error(401, "unauthenticated")),
        Answer::UpgradeRequired => Some(error(426, "upgrade-required")),
        Answer::ServerError => Some(error(503, "unavailable")),
        _ => None,
    }
}

/// Validates the body of a route that has a contract type, logs the request and applies the scripted answer.
async fn observe(State(shared): State<Arc<Shared>>, request: Request, next: Next) -> Response {
    let (parts, body) = request.into_parts();
    let Some(operation) = operation_of(&parts.method, parts.uri.path()) else {
        return next.run(Request::from_parts(parts, body)).await;
    };
    let Ok(bytes) = axum::body::to_bytes(body, MAX_BODY_BYTES).await else {
        return error(400, "invalid-request");
    };

    let parsed: Option<Value> = if bytes.is_empty() {
        None
    } else {
        serde_json::from_slice(&bytes).ok()
    };
    let invalid_body = match shared.validator_for(operation) {
        Some(validator) => !parsed
            .as_ref()
            .is_some_and(|value| validator.is_valid(value)),
        None => false,
    };

    let response = if invalid_body {
        error(400, "invalid-request")
    } else {
        let answer = shared.next_answer(operation);
        match scripted_failure(&answer) {
            Some(response) => response,
            None => {
                let mut request = Request::from_parts(parts.clone(), Body::from(bytes.clone()));
                request.extensions_mut().insert(answer);
                next.run(request).await
            }
        }
    };

    let headers = parts
        .headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                value.to_str().unwrap_or("").to_string(),
            )
        })
        .collect();
    lock(&shared.log).push(Logged {
        operation,
        path: parts.uri.path().to_string(),
        headers,
        body: parsed,
        status: response.status().as_u16(),
        invalid_body,
    });
    response
}

fn unexpected(answer: Answer) -> Response {
    error(500, &format!("no route answers {answer:?}"))
}

async fn request_code(
    State(shared): State<Arc<Shared>>,
    Extension(answer): Extension<Answer>,
) -> Response {
    match answer {
        Answer::Ok => {
            let elapsed = tokio::time::Instant::now().duration_since(shared.started);
            let start: DateTime<Utc> = WALL_START.parse().expect("a valid instant");
            let issued = start
                + TimeDelta::from_std(elapsed).expect("elapsed test time fits a TimeDelta")
                + TimeDelta::from_std(CODE_LIFETIME).expect("the lifetime fits a TimeDelta");
            let expires_at = serde_json::to_value(issued).expect("a date-time serializes");
            (
                StatusCode::CREATED,
                Json(json!({ "code": CODE, "expiresAt": expires_at, "claimSecret": CLAIM_SECRET })),
            )
                .into_response()
        }
        other => unexpected(other),
    }
}

async fn claim(Extension(answer): Extension<Answer>) -> Response {
    match answer {
        Answer::Ok => (StatusCode::OK, Json(json!({ "token": TOKEN }))).into_response(),
        Answer::Pending => {
            (StatusCode::ACCEPTED, Json(json!({ "status": "pending" }))).into_response()
        }
        Answer::Gone => error(410, "gone"),
        other => unexpected(other),
    }
}

async fn heartbeat(Extension(answer): Extension<Answer>) -> Response {
    match answer {
        Answer::Ok => StatusCode::NO_CONTENT.into_response(),
        other => unexpected(other),
    }
}

async fn assignment(Extension(answer): Extension<Answer>) -> Response {
    match answer {
        Answer::Ok => (StatusCode::OK, Json(assignment_payload())).into_response(),
        Answer::NoAssignment => error(404, "no-assignment"),
        other => unexpected(other),
    }
}

async fn observation(Extension(answer): Extension<Answer>) -> Response {
    match answer {
        Answer::Ok => (StatusCode::ACCEPTED, Json(json!({ "stored": true }))).into_response(),
        other => unexpected(other),
    }
}

async fn stream(
    State(shared): State<Arc<Shared>>,
    Extension(answer): Extension<Answer>,
    headers: HeaderMap,
) -> Response {
    if answer != Answer::Ok {
        return unexpected(answer);
    }
    let last_event_id = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let (replay, live) = shared.subscribe(last_event_id.as_deref());

    let replayed = iter(
        replay
            .into_iter()
            .map(|event| Ok::<Event, Infallible>(to_sse(event))),
    );
    let live = BroadcastStream::new(live).filter_map(|received| {
        received
            .ok()
            .map(|event| Ok::<Event, Infallible>(to_sse(event)))
    });
    Sse::new(replayed.chain(live))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(25))
                .text("ka"),
        )
        .into_response()
}

fn to_sse(event: StreamEvent) -> Event {
    Event::default()
        .id(event.id)
        .event(event.name)
        .data(event.data)
}
