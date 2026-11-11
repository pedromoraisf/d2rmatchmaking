//! The HTTP gateway: implements the `ApiGateway` port by calling the unchanged `ApiClient` and translating each answer
//! through the anti-corruption layer (design.md § Adapters, `http/gateway.rs`; AHM-16). It holds no rule of its own beyond
//! the protocol check of the resume id.

use d2rmm_agent_core::messages::{GameNameObservation, IssuedCode, Presence};
use d2rmm_agent_core::ports::{ApiError, ApiGateway, EventStream};
use d2rmm_agent_core::secret::Secret;
use d2rmm_agent_domain::characters::Card;
use d2rmm_agent_domain::room_assignment::Assignment;

use crate::http::api_client::ApiClient;
use crate::http::sse::valid_last_event_id;
use crate::http::sse_stream::SseEventStream;
use crate::http::translate::{
    assignment_from_contract, characters_to_contract, heartbeat_from_presence,
    issued_code_from_contract, observation_to_contract,
};

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

    async fn post_characters(&self, token: &Secret, cards: &[Card]) -> Result<(), ApiError> {
        let body = characters_to_contract(cards).map_err(|_| ApiError::Invalid)?;
        self.api.post_characters(token, &body).await
    }

    async fn accept_ready_check(&self, token: &Secret, check_id: &str) -> Result<(), ApiError> {
        self.api.accept_ready_check(token, check_id).await
    }

    async fn open_stream(
        &self,
        token: &Secret,
        last_event_id: Option<&str>,
    ) -> Result<Box<dyn EventStream>, ApiError> {
        // A resume id the protocol limits refuse is not sent: the stream starts from the beginning instead.
        let resume = last_event_id.filter(|id| valid_last_event_id(id));
        let response = self.api.open_stream(token, resume).await?;
        Ok(Box::new(SseEventStream::new(
            response,
            resume.map(str::to_string),
        )))
    }
}
