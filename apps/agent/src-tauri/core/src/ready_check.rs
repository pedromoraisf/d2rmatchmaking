//! The ready check's answer from the agent (RDY-02, RDY-06, RDY-07). The hotkey accepts the check the stream opened, while it is
//! open and before its deadline. The agent calls the accept route only: it sends no keystroke, click or other input to the
//! game or to any window (ADR 010).

use chrono::{DateTime, Utc};

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

/// Accepts the ready check the agent holds, if it is open at `now`. Nothing else is called.
pub async fn accept_held<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &StreamPorts<G>,
    now: DateTime<Utc>,
) -> AcceptOutcome {
    let Some(check) = device.answerable_ready_check(now) else {
        return AcceptOutcome::NothingOpen;
    };
    let Some(token) = ports.tokens.load() else {
        return AcceptOutcome::NothingOpen;
    };
    match ports.gateway.accept_ready_check(&token, &check.id).await {
        Ok(()) => AcceptOutcome::Accepted,
        Err(ApiError::CheckEnded) => {
            device.close_ready_check(&check.id);
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

    use chrono::{DateTime, TimeDelta, Utc};

    use super::{AcceptOutcome, accept_held};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::StreamPorts;
    use crate::messages::ReadyCheckOpen;
    use crate::ports::{ApiError, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    fn instant() -> DateTime<Utc> {
        "2026-11-10T12:00:00Z".parse().expect("a valid instant")
    }

    /// A paired device with a held ready check that ends at `instant() + 60 s`, and its ports over `gateway`.
    fn holding(gateway: &Arc<FakeApiGateway>) -> (DeviceState, StreamPorts<FakeApiGateway>) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        device.open_ready_check(ReadyCheckOpen {
            id: "rc-1".to_string(),
            deadline: instant() + TimeDelta::seconds(60),
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

    #[tokio::test]
    async fn an_open_check_is_accepted_by_its_id() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Ok(())]);
        let (device, ports) = holding(&gateway);

        let outcome = accept_held(&device, &ports, instant()).await;

        assert_eq!(outcome, AcceptOutcome::Accepted);
        assert_eq!(
            accept_calls(&gateway),
            vec![Call::AcceptReadyCheck {
                check_id: "rc-1".to_string()
            }]
        );
    }

    #[tokio::test]
    async fn no_held_check_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway);
        device.close_ready_check("rc-1");

        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }

    #[tokio::test]
    async fn a_check_past_its_deadline_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway);
        let at_deadline = instant() + TimeDelta::seconds(60);

        assert_eq!(
            accept_held(&device, &ports, at_deadline).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }

    #[tokio::test]
    async fn accepts_at_59_999_seconds_and_not_at_60() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Ok(())]);
        let (device, ports) = holding(&gateway);

        let just_before = instant() + TimeDelta::milliseconds(59_999);
        assert_eq!(
            accept_held(&device, &ports, just_before).await,
            AcceptOutcome::Accepted
        );
        assert_eq!(
            accept_held(&device, &ports, instant() + TimeDelta::seconds(60)).await,
            AcceptOutcome::NothingOpen
        );
    }

    #[tokio::test]
    async fn an_ended_check_is_forgotten_and_not_asked_again() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::CheckEnded)]);
        let (device, ports) = holding(&gateway);

        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::Ended
        );
        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::NothingOpen
        );
        assert_eq!(accept_calls(&gateway).len(), 1);
    }

    #[tokio::test]
    async fn a_network_failure_keeps_the_check_for_the_next_press() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::Network), Ok(())]);
        let (device, ports) = holding(&gateway);

        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::Failed
        );
        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::Accepted
        );
    }

    #[tokio::test]
    async fn an_unauthorized_answer_drops_the_token_as_every_route_does() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_accept_ready_check([Err(ApiError::Unauthorized)]);
        let (device, ports) = holding(&gateway);

        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::Failed
        );
        assert!(ports.tokens.load().is_none());
    }

    #[tokio::test]
    async fn an_unpaired_agent_sends_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, ports) = holding(&gateway);
        ports.tokens.delete();

        assert_eq!(
            accept_held(&device, &ports, instant()).await,
            AcceptOutcome::NothingOpen
        );
        assert!(accept_calls(&gateway).is_empty());
    }
}
