//! The agent's relay client (OBS-19, AD-101). It posts OTLP batches to the relay over `reqwest`, never follows a redirect,
//! adds the bearer token and the agent version to each request, and turns the relay's answer into what the exporter does
//! next. The token never reaches a log line, an error text or a span: nothing here logs.

use std::collections::hash_map::DefaultHasher;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use d2rmm_agent_core::secret::Secret;
use opentelemetry_http::{Bytes, HttpClient, HttpError, Request, Response};
use reqwest::header::{AUTHORIZATION, HeaderValue, RETRY_AFTER};
use reqwest::{Client, redirect::Policy};

/// The wait after a `429` that carries no `Retry-After` (OBS-19).
pub const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(60);
/// The longest wait a `Retry-After` can cause, so a server value cannot silence export for good (OBS-19).
pub const MAX_RETRY_AFTER: Duration = Duration::from_secs(60 * 60);
/// How often a refused token is probed while export is stopped (AD-101).
pub const PROBE_INTERVAL: Duration = Duration::from_secs(60 * 60);

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const AGENT_VERSION_HEADER: &str = "x-agent-version";

/// What the relay's answer means for the batch and for the next one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The relay took the batch (`2xx`).
    Delivered,
    /// The batch is dropped; export goes on with the next one.
    Drop,
    /// The batch is dropped and export stops while the token is the refused one (AD-101).
    DropAndStop,
    /// No export before this instant (`429` with `Retry-After`).
    WaitUntil(Instant),
}

/// Maps a relay status to an outcome. `Retry-After` is the number of seconds the relay asked for; a missing value waits
/// 60 seconds and any value is capped at one hour. Nothing is retried: a status that is not listed drops the batch.
pub fn outcome_of(status: u16, retry_after: Option<Duration>, now: Instant) -> Outcome {
    match status {
        200..=299 => Outcome::Delivered,
        401 => Outcome::DropAndStop,
        429 => {
            let wait = retry_after
                .unwrap_or(DEFAULT_RETRY_AFTER)
                .min(MAX_RETRY_AFTER);
            Outcome::WaitUntil(now + wait)
        }
        _ => Outcome::Drop,
    }
}

/// Reads a `Retry-After` value given in seconds. An HTTP date is not parsed and counts as absent.
pub fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// Whether the next batch may be sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Send,
    Hold,
}

/// The export state the client keeps between batches. Pure: the caller passes the token hash and the instant.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ExportState {
    blocked_until: Option<Instant>,
    refused_token: Option<u64>,
    next_probe: Option<Instant>,
}

impl ExportState {
    /// Decides whether a batch may go out now. Nothing goes out before a token exists, during a `429` wait, or while the
    /// token is the one the relay refused, except for one probe an hour (AD-101).
    pub fn admit(&mut self, token: Option<u64>, now: Instant) -> Admission {
        let Some(token) = token else {
            return Admission::Hold;
        };
        if self.blocked_until.is_some_and(|until| now < until) {
            return Admission::Hold;
        }
        if self.refused_token != Some(token) {
            return Admission::Send;
        }
        match self.next_probe {
            Some(probe) if now < probe => Admission::Hold,
            _ => {
                self.next_probe = Some(now + PROBE_INTERVAL);
                Admission::Send
            }
        }
    }

    /// Records the outcome of a batch sent with the token `token`.
    pub fn record(&mut self, outcome: Outcome, token: Option<u64>, now: Instant) {
        match outcome {
            Outcome::Delivered => {
                if self.refused_token == token {
                    self.refused_token = None;
                    self.next_probe = None;
                }
            }
            Outcome::Drop => {}
            Outcome::DropAndStop => {
                self.refused_token = token;
                self.next_probe = Some(now + PROBE_INTERVAL);
            }
            Outcome::WaitUntil(until) => self.blocked_until = Some(until),
        }
    }
}

/// The hash the export state compares tokens by. It never leaves the process.
pub fn token_hash(token: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    hasher.finish()
}

/// What the client reads per request: the device's token and the agent version. Each composition root implements it over
/// its token store, so the token is read when a request is built and is never captured.
pub trait HeaderSource: Send + Sync {
    /// The bearer token, or `None` before the device is paired.
    fn token(&self) -> Option<Secret>;
    /// The agent version, sent as `X-Agent-Version`.
    fn agent_version(&self) -> String;
}

/// The error the exporter gets for a batch the client did not send.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the relay export is paused")]
pub struct ExportPaused;

/// The `opentelemetry_http` client that posts to the relay. Redirects are refused, so the bearer token never follows one.
pub struct RelayHttpClient {
    client: Client,
    headers: Arc<dyn HeaderSource>,
    state: Mutex<ExportState>,
}

impl fmt::Debug for RelayHttpClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RelayHttpClient")
    }
}

impl RelayHttpClient {
    /// Builds the client with rustls, no redirects and the timeouts of the relay.
    pub fn new(headers: Arc<dyn HeaderSource>) -> reqwest::Result<Self> {
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self {
            client,
            headers,
            state: Mutex::new(ExportState::default()),
        })
    }

    fn state(&self) -> MutexGuard<'_, ExportState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[async_trait]
impl HttpClient for RelayHttpClient {
    async fn send_bytes(&self, request: Request<Bytes>) -> Result<Response<Bytes>, HttpError> {
        let token = self.headers.token();
        let hash = token.as_ref().map(|secret| token_hash(secret.expose()));
        let admission = self.state().admit(hash, Instant::now());
        let (Admission::Send, Some(token)) = (admission, token) else {
            return Err(Box::new(ExportPaused));
        };

        let (parts, body) = request.into_parts();
        let mut authorization = HeaderValue::from_str(&format!("Bearer {}", token.expose()))
            .map_err(|error| -> HttpError { Box::new(error) })?;
        authorization.set_sensitive(true);
        let version = HeaderValue::from_str(&self.headers.agent_version())
            .map_err(|error| -> HttpError { Box::new(error) })?;

        let response = self
            .client
            .request(parts.method, parts.uri.to_string())
            .headers(parts.headers)
            .header(AUTHORIZATION, authorization)
            .header(AGENT_VERSION_HEADER, version)
            .body(body)
            .send()
            .await
            .map_err(|error| -> HttpError { Box::new(error) })?;

        let status = response.status();
        let retry_after = response
            .headers()
            .get(RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_retry_after);
        let answer = response
            .bytes()
            .await
            .map_err(|error| -> HttpError { Box::new(error) })?;

        let now = Instant::now();
        let outcome = outcome_of(status.as_u16(), retry_after, now);
        self.state().record(outcome, hash, now);

        let mut reply = Response::new(answer);
        *reply.status_mut() = status;
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use d2rmm_agent_core::secret::Secret;
    use opentelemetry_http::{Bytes, HttpClient, Request};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{
        Admission, DEFAULT_RETRY_AFTER, ExportState, HeaderSource, MAX_RETRY_AFTER, Outcome,
        PROBE_INTERVAL, RelayHttpClient, outcome_of, parse_retry_after, token_hash,
    };

    fn drops_the_batch(outcome: Outcome) -> bool {
        matches!(outcome, Outcome::Drop | Outcome::DropAndStop)
    }

    #[test]
    fn status_401_403_413_415_drop_the_batch() {
        let now = Instant::now();
        for status in [401_u16, 403, 413, 415] {
            assert!(
                drops_the_batch(outcome_of(status, None, now)),
                "status {status} drops the batch"
            );
        }
        assert_eq!(outcome_of(202, None, now), Outcome::Delivered);
    }

    #[test]
    fn status_401_stops_export_until_the_token_changes() {
        let now = Instant::now();
        let refused = token_hash("token-one");
        let other = token_hash("token-two");
        let mut state = ExportState::default();

        assert_eq!(
            state.admit(None, now),
            Admission::Hold,
            "nothing before a token"
        );
        assert_eq!(state.admit(Some(refused), now), Admission::Send);
        state.record(outcome_of(401, None, now), Some(refused), now);

        assert_eq!(
            state.admit(Some(refused), now),
            Admission::Hold,
            "the refused token stops export"
        );
        assert_eq!(
            state.admit(Some(other), now),
            Admission::Send,
            "a new token resumes export"
        );

        let probe_due = now + PROBE_INTERVAL;
        assert_eq!(
            state.admit(Some(refused), probe_due),
            Admission::Send,
            "one probe an hour"
        );
        state.record(outcome_of(401, None, probe_due), Some(refused), probe_due);
        assert_eq!(
            state.admit(Some(refused), probe_due + Duration::from_secs(1)),
            Admission::Hold,
            "a refused probe waits another hour"
        );

        state.record(Outcome::Delivered, Some(refused), probe_due);
        assert_eq!(
            state.admit(Some(refused), probe_due + Duration::from_secs(1)),
            Admission::Send,
            "a probe the relay accepts ends the stop"
        );
    }

    #[test]
    fn status_429_waits_for_retry_after_capped_at_one_hour() {
        let now = Instant::now();

        assert_eq!(
            outcome_of(429, Some(Duration::from_secs(10)), now),
            Outcome::WaitUntil(now + Duration::from_secs(10)),
        );
        assert_eq!(
            outcome_of(429, Some(Duration::from_secs(90_000)), now),
            Outcome::WaitUntil(now + MAX_RETRY_AFTER),
            "a server value above one hour is capped"
        );

        let mut state = ExportState::default();
        let token = token_hash("token");
        state.record(
            outcome_of(429, Some(Duration::from_secs(10)), now),
            Some(token),
            now,
        );
        assert_eq!(
            state.admit(Some(token), now + Duration::from_secs(9)),
            Admission::Hold
        );
        assert_eq!(
            state.admit(Some(token), now + Duration::from_secs(10)),
            Admission::Send
        );
    }

    #[test]
    fn status_429_without_retry_after_waits_sixty_seconds() {
        let now = Instant::now();

        assert_eq!(DEFAULT_RETRY_AFTER, Duration::from_secs(60));
        assert_eq!(
            outcome_of(429, None, now),
            Outcome::WaitUntil(now + Duration::from_secs(60)),
        );
    }

    #[test]
    fn retry_after_reads_seconds_and_ignores_dates() {
        assert_eq!(parse_retry_after(" 15 "), Some(Duration::from_secs(15)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
        assert_eq!(parse_retry_after("-5"), None);
    }

    struct FixedHeaders;

    impl HeaderSource for FixedHeaders {
        fn token(&self) -> Option<Secret> {
            Some(Secret::new("device-token"))
        }

        fn agent_version(&self) -> String {
            "1.2.3".to_string()
        }
    }

    /// A one-shot relay: it records the request head and answers with `response`.
    async fn one_shot_relay(
        response: &'static str,
    ) -> (std::net::SocketAddr, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind a local port");
        let address = listener.local_addr().expect("local address");
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut buffer = vec![0_u8; 8192];
            let read = socket.read(&mut buffer).await.expect("read the request");
            socket
                .write_all(response.as_bytes())
                .await
                .expect("write the answer");
            String::from_utf8_lossy(&buffer[..read]).to_string()
        });
        (address, task)
    }

    fn post(address: std::net::SocketAddr) -> Request<Bytes> {
        Request::builder()
            .method("POST")
            .uri(format!("http://{address}/v1/telemetry/traces"))
            .header("content-type", "application/x-protobuf")
            .body(Bytes::from_static(b"batch"))
            .expect("a request")
    }

    #[tokio::test]
    async fn a_batch_carries_the_bearer_token_and_the_agent_version() {
        let (address, head) = one_shot_relay(
            "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
        let client = RelayHttpClient::new(Arc::new(FixedHeaders)).expect("the client builds");

        let reply = client
            .send_bytes(post(address))
            .await
            .expect("the relay answers");

        assert_eq!(reply.status().as_u16(), 202);
        let request = head.await.expect("the relay task").to_ascii_lowercase();
        assert!(
            request.contains("authorization: bearer device-token"),
            "bearer header: {request}"
        );
        assert!(
            request.contains("x-agent-version: 1.2.3"),
            "version header: {request}"
        );
    }

    #[tokio::test]
    async fn a_redirect_is_returned_and_never_followed() {
        let (address, _head) = one_shot_relay("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        let client = RelayHttpClient::new(Arc::new(FixedHeaders)).expect("the client builds");

        let reply = client
            .send_bytes(post(address))
            .await
            .expect("the relay answers");

        assert_eq!(
            reply.status().as_u16(),
            302,
            "the redirect reaches the exporter as is"
        );
        assert!(drops_the_batch(outcome_of(302, None, Instant::now())));
    }
}
