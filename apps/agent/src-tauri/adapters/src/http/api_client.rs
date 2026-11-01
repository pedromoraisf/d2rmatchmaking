//! The HTTP client of the agent core (design.md § API client; AGS-12, AGS-23, AGS-35). One method per agent route.
//! Every request carries `X-Agent-Version` and the `traceparent` of the span that opened it, and the token travels in
//! a sensitive `Authorization` header. Bodies are contract types only. Nothing from a request or a response is logged.

use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderValue, RETRY_AFTER};
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use tracing::field::Empty;
use tracing::{Instrument, Span, info_span};
use uuid::Uuid;

use d2rmm_agent_core::secret::Secret;

use crate::config::ApiBase;
use crate::contracts::generated::{
    Assignment, ClaimRequest, ClaimResponse, Heartbeat, Observation, PairingCodeResponse,
};
use crate::telemetry::traceparent_for;

/// `ApiError` is defined with the ports in the core; this module re-exports it, so its callers keep the path.
pub use d2rmm_agent_core::ports::ApiError;

const VERSION_HEADER: &str = "x-agent-version";
const TRACEPARENT_HEADER: &str = "traceparent";
const LAST_EVENT_ID_HEADER: &str = "last-event-id";
const RETRY_AFTER_MIN_SECONDS: u64 = 1;
const RETRY_AFTER_MAX_SECONDS: u64 = 60 * 60;

/// The stream is open as long as the agent runs. The client's 30 s request timeout must not cut it, so this request
/// overrides it with a value far beyond any session. The idle timeout belongs to the stream reader.
const STREAM_REQUEST_TIMEOUT: Duration = Duration::from_secs(365 * 24 * 60 * 60);

/// Calls the agent routes of the API. The client is built by the app and already configured (HTTPS, timeouts).
#[derive(Debug, Clone)]
pub struct ApiClient {
    http: Client,
    base: String,
    version: String,
}

impl ApiClient {
    pub fn new(version: &str, api_base: &ApiBase, http: Client) -> Self {
        Self {
            http,
            base: api_base.url().as_str().trim_end_matches('/').to_string(),
            version: version.to_string(),
        }
    }

    /// `POST /v1/agents/pairing-codes`: a fresh code and its claim secret.
    pub async fn request_code(&self) -> Result<PairingCodeResponse, ApiError> {
        let span = info_span!("agent.http.request_code", status = Empty);
        async {
            let request = self.anonymous(Method::POST, "/v1/agents/pairing-codes");
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::CREATED => json_body(response).await,
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// `POST /v1/agents/pairing-codes/claim`: the token once the player has typed the code.
    pub async fn claim(&self, claim_secret: &Secret) -> Result<Secret, ApiError> {
        let span = info_span!("agent.http.claim", status = Empty);
        async {
            let body = ClaimRequest {
                claim_secret: claim_secret.clone(),
            };
            let request = self
                .anonymous(Method::POST, "/v1/agents/pairing-codes/claim")
                .json(&body);
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::OK => {
                    let claimed: ClaimResponse = json_body(response).await?;
                    Ok(claimed.token)
                }
                StatusCode::ACCEPTED => Err(ApiError::Pending),
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// `POST /v1/agents/heartbeat`.
    pub async fn heartbeat(&self, token: &Secret, body: &Heartbeat) -> Result<(), ApiError> {
        let span = info_span!("agent.http.heartbeat", status = Empty);
        async {
            let request = self
                .authorized(Method::POST, "/v1/agents/heartbeat", token)?
                .json(body);
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::NO_CONTENT => Ok(()),
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// `GET /v1/agents/me/assignment`. `None` when the agent holds no room (404).
    pub async fn assignment(&self, token: &Secret) -> Result<Option<Assignment>, ApiError> {
        let span = info_span!("agent.http.assignment", status = Empty);
        async {
            let request = self.authorized(Method::GET, "/v1/agents/me/assignment", token)?;
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::OK => json_body(response).await.map(Some),
                StatusCode::NOT_FOUND => Ok(None),
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// `POST /v1/lobby-rooms/{room}/observations`.
    pub async fn post_observation(
        &self,
        token: &Secret,
        room: Uuid,
        observation: &Observation,
    ) -> Result<(), ApiError> {
        let span = info_span!("agent.http.observation", status = Empty);
        async {
            let path = format!("/v1/lobby-rooms/{room}/observations");
            let request = self
                .authorized(Method::POST, &path, token)?
                .json(observation);
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::ACCEPTED => Ok(()),
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// `GET /v1/stream`. The response is handed to the stream reader, which parses the events (AGS-13).
    pub async fn open_stream(
        &self,
        token: &Secret,
        last_event_id: Option<&str>,
    ) -> Result<Response, ApiError> {
        let span = info_span!("agent.http.stream", status = Empty);
        async {
            let mut request = self
                .authorized(Method::GET, "/v1/stream", token)?
                .header(ACCEPT, "text/event-stream")
                .timeout(STREAM_REQUEST_TIMEOUT);
            if let Some(id) = last_event_id {
                request = request.header(LAST_EVENT_ID_HEADER, id);
            }
            let response = self.send(request).await?;
            match response.status() {
                StatusCode::OK => Ok(response),
                _ => Err(failure(&response)),
            }
        }
        .instrument(span)
        .await
    }

    /// A request without a token, carrying the version and the traceparent of the current span.
    fn anonymous(&self, method: Method, path: &str) -> RequestBuilder {
        let url = format!("{}{path}", self.base);
        let mut request = self
            .http
            .request(method, url)
            .header(VERSION_HEADER, self.version.as_str());
        if let Some(traceparent) = traceparent_for(&Span::current()) {
            request = request.header(TRACEPARENT_HEADER, traceparent);
        }
        request
    }

    fn authorized(
        &self,
        method: Method,
        path: &str,
        token: &Secret,
    ) -> Result<RequestBuilder, ApiError> {
        let value = authorization_value(token)?;
        Ok(self.anonymous(method, path).header(AUTHORIZATION, value))
    }

    /// Sends the request and records its status on the current span.
    async fn send(&self, request: RequestBuilder) -> Result<Response, ApiError> {
        let response = request.send().await.map_err(|_| ApiError::Network)?;
        Span::current().record("status", response.status().as_u16());
        Ok(response)
    }
}

async fn json_body<T: DeserializeOwned>(response: Response) -> Result<T, ApiError> {
    response.json::<T>().await.map_err(|error| {
        if error.is_decode() {
            ApiError::Invalid
        } else {
            ApiError::Network
        }
    })
}

/// The `Authorization` header for a token. Marked sensitive, so HTTP stacks keep it out of their own logs.
pub fn authorization_value(token: &Secret) -> Result<HeaderValue, ApiError> {
    let mut value = HeaderValue::from_str(&format!("Bearer {}", token.expose()))
        .map_err(|_| ApiError::Invalid)?;
    value.set_sensitive(true);
    Ok(value)
}

/// Maps a status the route does not expect to its error. The body is never read: error bodies are never shown.
fn failure(response: &Response) -> ApiError {
    match response.status() {
        StatusCode::UNAUTHORIZED => ApiError::Unauthorized,
        StatusCode::GONE => ApiError::Gone,
        StatusCode::TOO_MANY_REQUESTS => ApiError::RateLimited {
            retry_after: retry_after(response),
        },
        StatusCode::UPGRADE_REQUIRED => ApiError::UpgradeRequired,
        status if status.is_server_error() => ApiError::Server,
        _ => ApiError::Invalid,
    }
}

/// `Retry-After` in seconds, clamped to [1 s, 60 min]. A value that is not a number counts as absent.
fn retry_after(response: &Response) -> Option<Duration> {
    let raw = response.headers().get(RETRY_AFTER)?.to_str().ok()?;
    clamp_retry_after(raw)
}

/// The wait a `Retry-After` value asks for: trimmed, parsed as seconds and clamped to [1 s, 60 min]. `None` when the
/// value is not a number.
fn clamp_retry_after(raw: &str) -> Option<Duration> {
    let seconds: u64 = raw.trim().parse().ok()?;
    Some(Duration::from_secs(
        seconds.clamp(RETRY_AFTER_MIN_SECONDS, RETRY_AFTER_MAX_SECONDS),
    ))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{authorization_value, clamp_retry_after};
    use d2rmm_agent_core::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    #[test]
    fn retry_after_floor_is_one_second() {
        assert_eq!(clamp_retry_after("0"), Some(Duration::from_secs(1)));
        assert_eq!(clamp_retry_after("1"), Some(Duration::from_secs(1)));
    }

    #[test]
    fn retry_after_cap_is_sixty_minutes() {
        assert_eq!(clamp_retry_after("3600"), Some(Duration::from_secs(3600)));
        assert_eq!(clamp_retry_after("3601"), Some(Duration::from_secs(3600)));
        assert_eq!(clamp_retry_after("99999"), Some(Duration::from_secs(3600)));
    }

    #[test]
    fn retry_after_ignores_non_numbers() {
        assert_eq!(clamp_retry_after("abc"), None);
        assert_eq!(clamp_retry_after(""), None);
        assert_eq!(clamp_retry_after("-5"), None);
        assert_eq!(clamp_retry_after(" 30 "), Some(Duration::from_secs(30)));
    }

    #[test]
    fn authorization_header_is_marked_sensitive() {
        let value = authorization_value(&Secret::new(TOKEN)).expect("a token makes a header value");
        assert!(value.is_sensitive());
        assert_eq!(
            value.to_str().expect("the header is ASCII"),
            format!("Bearer {TOKEN}")
        );
    }
}
