//! The HTTP gateway: implements the `ApiGateway` port by calling the unchanged `ApiClient` and translating each answer
//! through the anti-corruption layer (design.md § Adapters, `http/gateway.rs`; AHM-16). It holds no rule of its own.

use crate::api_client::ApiClient;
use crate::gateway::translate::{
    assignment_from_contract, heartbeat_from_presence, issued_code_from_contract,
    observation_to_contract,
};
use crate::messages::{Assignment, GameNameObservation, IssuedCode, Presence};
use crate::ports::{ApiError, ApiGateway, EventStream};
use crate::secret::Secret;

/// The agent's API calls over HTTP. The client is built by the app and already configured (HTTPS, timeouts).
#[derive(Debug, Clone)]
pub struct HttpGateway {
    api: ApiClient,
}

impl HttpGateway {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }
}

impl ApiGateway for HttpGateway {
    async fn request_code(&self) -> Result<IssuedCode, ApiError> {
        let response = self.api.request_code().await?;
        issued_code_from_contract(response).map_err(|_| ApiError::Invalid)
    }

    async fn claim(&self, claim_secret: &Secret) -> Result<Secret, ApiError> {
        self.api.claim(claim_secret).await
    }

    async fn heartbeat(
        &self,
        token: &Secret,
        presence: &Presence,
        version: &str,
    ) -> Result<(), ApiError> {
        let body = heartbeat_from_presence(presence, version).map_err(|_| ApiError::Invalid)?;
        self.api.heartbeat(token, &body).await
    }

    async fn assignment(&self, token: &Secret) -> Result<Option<Assignment>, ApiError> {
        let assignment = self.api.assignment(token).await?;
        Ok(assignment.map(assignment_from_contract))
    }

    async fn post_observation(
        &self,
        token: &Secret,
        observation: &GameNameObservation,
    ) -> Result<(), ApiError> {
        let body = observation_to_contract(observation).map_err(|_| ApiError::Invalid)?;
        self.api
            .post_observation(token, observation.room, &body)
            .await
    }

    /// The room stream is wired in T17 (`gateway/sse_stream.rs`). Until then no caller opens a stream through the port.
    async fn open_stream(
        &self,
        _token: &Secret,
        _last_event_id: Option<&str>,
    ) -> Result<Box<dyn EventStream>, ApiError> {
        Err(ApiError::Invalid)
    }
}
