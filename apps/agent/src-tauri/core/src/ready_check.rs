//! The ready check's answer from the agent (RDY-02, RDY-06, RDY-07). The hotkey accepts the check the stream or the API
//! opened, while its time has not run out. The agent calls the accept route only: it sends no keystroke, click or other
//! input to the game or to any window (ADR 010).

use crate::device_state::DeviceState;
use crate::groups::StreamPorts;
use crate::ports::{ApiError, ApiGateway, TokenStore};

/// What one press of the hotkey did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptOutcome {
    /// The API took the acceptance.
    Accepted,
    /// No ready check is open for the agent at that instant: nothing was sent.
    NothingOpen,
    /// The API said the check ended or the acceptance was already given; the agent forgets the check.
    Ended,
    /// The request did not reach an answer the agent accepts; a 401 or a 426 changed the agent's state as usual.
    Failed,
}

/// Accepts the ready check the agent holds, while its time has not run out. Nothing else is called.
pub async fn accept_held<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &StreamPorts<G>,
) -> AcceptOutcome {
    let Some(id) = device.answerable_ready_check() else {
        return AcceptOutcome::NothingOpen;
    };
    let Some(token) = ports.tokens.load() else {
        return AcceptOutcome::NothingOpen;
    };
    match ports.gateway.accept_ready_check(&token, &id).await {
        Ok(()) => AcceptOutcome::Accepted,
        Err(ApiError::CheckEnded) => {
            device.close_ready_check(&id);
            AcceptOutcome::Ended
        }
        Err(error) => {
            device.handle_api_error(&error, ports.tokens.as_ref() as &dyn TokenStore);
            AcceptOutcome::Failed
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::{AcceptOutcome, accept_held};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::StreamPorts;
    use crate::messages::ReadyCheckOpen;
    use crate::ports::{ApiError, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    /// A paired device with a held ready check that has `remaining` left, and its ports over `gateway`.
    fn holding(
        gateway: &Arc<FakeApiGateway>,
        remaining: Duration,
    ) -> (DeviceState, StreamPorts<FakeApiGateway>) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        device.open_ready_check(ReadyCheckOpen {
            id: "rc-1".to_string(),
            remaining,
        });
        let ports = StreamPorts {
            gateway: Arc::clone(gateway),
            tokens,
        };
        (device, ports)
    }

    fn accept_calls(gateway: &FakeApiGateway) -> Vec<Call> {
        gateway
            .calls()
            .into_iter()
            .filter(|call| matches!(call, Call::AcceptReadyCheck { .. }))
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn an_open_check_is_accepted_by_its_id() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Ok(())]);
        let (device, ports) = holding(&gateway, Duration::from_secs(60));

        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Accepted);
        assert_eq!(
            accept_calls(&gateway),
            vec![Call::AcceptReadyCheck {
                check_id: "rc-1".to_string()
            }]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn no_held_check_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway, Duration::from_secs(60));
        device.close_ready_check("rc-1");

        assert_eq!(
            accept_held(&device, &ports).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_check_whose_time_ran_out_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway, Duration::from_secs(60));
        tokio::time::advance(Duration::from_secs(60)).await;

        assert_eq!(
            accept_held(&device, &ports).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn accepts_at_59_999_milliseconds_and_not_at_60_seconds() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Ok(())]);
        let (device, ports) = holding(&gateway, Duration::from_secs(60));

        tokio::time::advance(Duration::from_millis(59_999)).await;
        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Accepted);
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(
            accept_held(&device, &ports).await,
            AcceptOutcome::NothingOpen
        );
    }

    #[tokio::test(start_paused = true)]
    async fn an_ended_check_is_forgotten_and_not_asked_again() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::CheckEnded)]);
        let (device, ports) = holding(&gateway, Duration::from_secs(60));

        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Ended);
        assert_eq!(
            accept_held(&device, &ports).await,
            AcceptOutcome::NothingOpen
        );
        assert_eq!(accept_calls(&gateway).len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_network_failure_keeps_the_check_for_the_next_press() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::Network), Ok(())]);
        let (device, ports) = holding(&gateway, Duration::from_secs(60));

        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Failed);
        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Accepted);
    }

    #[tokio::test(start_paused = true)]
    async fn an_unauthorized_answer_drops_the_token_as_every_route_does() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::Unauthorized)]);
        let (device, ports) = holding(&gateway, Duration::from_secs(60));

        assert_eq!(accept_held(&device, &ports).await, AcceptOutcome::Failed);
        assert!(ports.tokens.load().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn an_unpaired_agent_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway, Duration::from_secs(60));
        ports.tokens.delete();

        assert_eq!(
            accept_held(&device, &ports).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }
}
