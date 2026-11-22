//! The observation sender (design.md § Vision and fusion, Sender; AGS-19; AD-051). An observation is posted with its
//! idempotency key; a network error or a 5xx is retried with the same key at 1, 2, 4 and 8 s, five attempts in all, then the
//! observation is dropped and counted. A 401 or a 426 drops it at once, and so does any retry that a 401 or 426 overtakes.
//! The retry schedule and the epoch rule are the domain's `ObservationRetry` (AHM-10); this use case does the posting, the
//! sleeping and the counting.

use d2rmm_agent_domain::observation_retry::{ObservationRetry, PostFailure, Retry, Wait};
use tokio::time::Instant;
use tracing::Instrument;

use crate::detail;
use crate::device_state::DeviceState;
use crate::groups::ReadPorts;
use crate::messages::GameNameObservation;
use crate::ports::{ApiError, ApiGateway};

/// How a send ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Posted,
    Dropped,
}

/// Posts `observation` to its room, retrying as AD-051 sets out. The observation is not changed between attempts.
pub async fn send<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ReadPorts<G>,
    observation: &GameNameObservation,
) -> SendOutcome {
    let Some(token) = ports.tokens.load() else {
        return drop_observation(device);
    };
    let mut retry = ObservationRetry::new(device.epoch());
    loop {
        let span = tracing::info_span!(
            "agent.observation.post",
            "d2r.room.id" = tracing::field::Empty,
            "d2r.run.id" = tracing::field::Empty,
            "d2r.game.name" = tracing::field::Empty,
            "d2r.ocr.confidence" = tracing::field::Empty,
            "d2r.step.duration_ms" = tracing::field::Empty,
        );
        detail::record_observation(
            &span,
            &observation.room.to_string(),
            observation.run.get(),
            &observation.game_name,
            observation.confidence,
        );
        let started = Instant::now();
        let outcome = ports
            .gateway
            .post_observation(&token, observation)
            .instrument(span.clone())
            .await;
        detail::record_duration(&span, started.elapsed());
        let error = match outcome {
            Ok(()) => {
                tracing::info_span!("agent.run.confirm")
                    .in_scope(|| tracing::info!("agent.run.confirmed"));
                device.confirm_run(&observation.room.to_string(), observation.run);
                return SendOutcome::Posted;
            }
            Err(error) => error,
        };
        if matches!(error, ApiError::Unauthorized | ApiError::UpgradeRequired) {
            device.handle_api_error(&error, ports.tokens.as_ref());
            return drop_observation(device);
        }

        let Wait::For(delay) = retry.after_failure(classify(&error)) else {
            return drop_observation(device);
        };
        let still_allowed = device
            .sleep_while_allowed(Instant::now() + delay, DeviceState::api_allowed)
            .await;
        if !still_allowed {
            return drop_observation(device);
        }
        if retry.after_sleep(device.epoch()) == Retry::Drop {
            return drop_observation(device);
        }
    }
}

fn drop_observation(device: &DeviceState) -> SendOutcome {
    device.count_dropped_observation();
    SendOutcome::Dropped
}

/// Maps a failed post to the retry policy: a lost network or a 5xx is transient, nothing else is (AD-051).
fn classify(error: &ApiError) -> PostFailure {
    match error {
        ApiError::Network | ApiError::Server => PostFailure::Transient,
        _ => PostFailure::Permanent,
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use chrono::{DateTime, Utc};
    use d2rmm_agent_domain::observation_retry::PostFailure;
    use uuid::Uuid;

    use super::{SendOutcome, classify, send};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NoText, NullSink};
    use crate::groups::ReadPorts;
    use crate::messages::GameNameObservation;
    use crate::ports::{ApiError, PausedWallClock, SequentialIds, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    fn instant() -> DateTime<Utc> {
        "2026-11-01T10:00:00Z".parse().expect("a valid instant")
    }

    fn observation() -> GameNameObservation {
        GameNameObservation {
            room: Uuid::from_u128(1),
            run: NonZeroU64::MIN,
            key: Uuid::from_u128(9),
            game_name: "mmbaalh-12".to_string(),
            confidence: 1.0,
            captured_at: instant(),
        }
    }

    /// A paired device whose token store holds the token, with every port faked in memory.
    fn paired() -> (
        DeviceState,
        Arc<MemoryTokens>,
        ReadPorts<FakeApiGateway>,
        Arc<FakeApiGateway>,
    ) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let gateway = Arc::new(FakeApiGateway::new());
        let ports = ReadPorts {
            reader: Arc::new(NoText),
            ids: Arc::new(SequentialIds::new()),
            clock: Arc::new(PausedWallClock::starting_at(instant())),
            gateway: Arc::clone(&gateway),
            tokens: tokens.clone(),
        };
        (device, tokens, ports, gateway)
    }

    /// The assignment the observation names: its room, run 1.
    fn held_assignment(run: u64) -> d2rmm_agent_domain::room_assignment::Assignment {
        d2rmm_agent_domain::room_assignment::Assignment {
            room: d2rmm_agent_domain::room_assignment::RoomId::new(
                "00000000-0000-0000-0000-000000000001",
            ),
            run: NonZeroU64::new(run).expect("a run is not zero"),
            expected_game_name: d2rmm_agent_domain::room_assignment::GameName::new("mmbaalh-12"),
            members: Vec::new(),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn an_accepted_post_confirms_the_run_in_the_window_until_the_run_changes() {
        let (device, _tokens, ports, gateway) = paired();
        gateway.script_post_observation([Ok(())]);
        let probe = crate::event_probe::EventProbe::default();
        let _guard = probe.install();
        device.replace_assignment(Some(held_assignment(1)));
        device.publish_room();
        let confirmed =
            |device: &DeviceState| device.hub.snapshot().room.map(|room| room.confirmed);
        assert_eq!(confirmed(&device), Some(false), "waiting before the post");

        send(&device, &ports, &observation()).await;
        assert_eq!(confirmed(&device), Some(true), "the 2xx confirms the run");
        let events = probe.named("agent.run.confirmed");
        assert_eq!(events.len(), 1);
        assert!(events[0].fields.is_empty(), "no names on the event");

        device.replace_assignment(Some(held_assignment(2)));
        device.publish_room();
        assert_eq!(
            confirmed(&device),
            Some(false),
            "a new run waits again (ARL-04)"
        );

        device.replace_assignment(None);
        device.publish_room();
        assert_eq!(confirmed(&device), None, "a dropped room shows no line");
    }

    #[tokio::test(start_paused = true)]
    async fn the_post_span_carries_the_ids_and_game_data_and_no_name() {
        let (device, _tokens, ports, gateway) = paired();
        gateway.script_post_observation([Ok(())]);
        let probe = crate::event_probe::EventProbe::default();
        let _guard = probe.install();
        device.replace_assignment(Some(held_assignment(1)));

        send(&device, &ports, &observation()).await;

        let spans = probe.spans();
        let post = spans
            .iter()
            .find(|span| span.message == "agent.observation.post")
            .expect("the post span");
        let sent = observation();
        assert_eq!(post.fields["d2r.room.id"], format!("\"{}\"", sent.room));
        assert_eq!(
            post.fields["d2r.run.id"],
            format!("\"{}/{}\"", sent.room, sent.run)
        );
        assert_eq!(
            post.fields["d2r.game.name"],
            format!("{:?}", sent.game_name)
        );
        assert!(post.fields.contains_key("d2r.ocr.confidence"));
        assert!(post.fields.contains_key("d2r.step.duration_ms"));
        for key in post.fields.keys() {
            assert!(
                !matches!(key.as_str(), "d2r.ocr.text" | "d2r.ocr.names"),
                "{key} is a full-tier key"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_refused_or_failed_post_keeps_waiting() {
        let (device, _tokens, ports, gateway) = paired();
        gateway.script_post_observation([Err(ApiError::Unauthorized)]);
        device.replace_assignment(Some(held_assignment(1)));
        device.publish_room();

        send(&device, &ports, &observation()).await;

        assert!(
            device
                .hub
                .snapshot()
                .room
                .is_none_or(|room| !room.confirmed),
            "nothing confirms a refused post"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn post_retries_with_the_same_key_five_attempts() {
        let (device, _tokens, ports, gateway) = paired();
        gateway.script_post_observation([
            Err(ApiError::Server),
            Err(ApiError::Network),
            Err(ApiError::Server),
            Err(ApiError::Network),
            Err(ApiError::Server),
        ]);
        let observation = observation();

        let outcome = send(&device, &ports, &observation).await;

        assert_eq!(outcome, SendOutcome::Dropped);
        assert_eq!(device.dropped_observations(), 1);
        let posts: Vec<GameNameObservation> = gateway
            .calls()
            .into_iter()
            .filter_map(|call| match call {
                Call::PostObservation(posted) => Some(posted),
                _ => None,
            })
            .collect();
        assert_eq!(posts.len(), 5, "five attempts in all, then the drop");
        assert!(
            posts.iter().all(|posted| *posted == observation),
            "every retry posts the same observation under the same key"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn post_drops_when_a_426_moves_the_epoch() {
        let (device, tokens, ports, gateway) = paired();
        gateway.script_post_observation([Err(ApiError::Server), Ok(())]);
        let observation = observation();
        let upgrade = async {
            tokio::time::sleep(Duration::from_millis(500)).await;
            device.on_upgrade_required(&*tokens);
        };

        let (outcome, ()) = tokio::join!(send(&device, &ports, &observation), upgrade);

        assert_eq!(outcome, SendOutcome::Dropped);
        assert_eq!(device.epoch(), 1, "the 426 moved the retry epoch");
        assert_eq!(device.dropped_observations(), 1);
        assert_eq!(gateway.calls().len(), 1, "no retry is posted after the 426");
    }

    #[tokio::test(start_paused = true)]
    async fn post_drops_when_the_gate_closes_during_sleep() {
        let (device, _tokens, ports, gateway) = paired();
        gateway.script_post_observation([Err(ApiError::Network), Ok(())]);
        let observation = observation();
        let unpair = async {
            tokio::time::sleep(Duration::from_millis(500)).await;
            device.set_paired(false);
        };

        let (outcome, ()) = tokio::join!(send(&device, &ports, &observation), unpair);

        assert_eq!(outcome, SendOutcome::Dropped);
        assert_eq!(device.epoch(), 0, "unpairing moves no retry epoch");
        assert_eq!(device.dropped_observations(), 1);
        assert_eq!(
            gateway.calls().len(),
            1,
            "no retry is posted once the gate is shut"
        );
    }

    #[test]
    fn only_network_and_server_errors_are_retried() {
        assert_eq!(classify(&ApiError::Network), PostFailure::Transient);
        assert_eq!(classify(&ApiError::Server), PostFailure::Transient);
        for error in [
            ApiError::Unauthorized,
            ApiError::UpgradeRequired,
            ApiError::RateLimited { retry_after: None },
            ApiError::Gone,
            ApiError::Pending,
            ApiError::Invalid,
        ] {
            assert_eq!(
                classify(&error),
                PostFailure::Permanent,
                "{error:?} must not be retried"
            );
        }
    }
}
