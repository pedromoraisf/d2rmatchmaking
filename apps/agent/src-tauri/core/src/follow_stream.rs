//! The follow-stream use case (design.md § Stream and assignment; AGS-13 to AGS-15; AD-059, AD-067).
//!
//! On pairing, start and every reconnect the agent fetches its assignment and then follows the room stream through the
//! gateway port, resuming after the last event id it saw. A dropped stream reconnects after 1 s, doubling to 60 s; a stream
//! that stayed open for 60 s resets the delay. The event rules, the parser and the protocol limits live in the adapters.

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::reconnect::Reconnect;
use d2rmm_agent_domain::room_assignment::Assignment;
use tokio::time::Instant;
use tracing::Instrument;

use crate::device_state::DeviceState;
use crate::groups::StreamPorts;
use crate::ports::{ApiError, ApiGateway, EventStream, StreamItem};

/// Runs for the life of the agent, whenever it is paired and not waiting for an update. The reconnect delay is the
/// domain's `Reconnect` (AHM-11): a stream that stayed open for a minute starts the backoff again.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: StreamPorts<G>,
) {
    let mut reconnect = Reconnect::new();
    let mut last_id: Option<String> = None;
    loop {
        device.wait_until_allowed(DeviceState::api_allowed).await;
        let span = tracing::info_span!("agent.stream.connect");
        let open_for = connect_once(&device, &ports, &mut last_id)
            .instrument(span)
            .await;
        reconnect.opened_for(open_for);
        if !device
            .sleep_while_allowed(Instant::now() + reconnect.delay(), DeviceState::api_allowed)
            .await
        {
            continue;
        }
        reconnect.slept();
    }
}

/// One attempt: fetch the assignment, open the stream and read it until it ends. Returns how long it stayed open.
async fn connect_once<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &StreamPorts<G>,
    last_id: &mut Option<String>,
) -> Duration {
    let Some(token) = ports.tokens.load() else {
        return Duration::ZERO;
    };
    // A 426 that arrived since the loop last checked stops the requests (AGS-27).
    if !device.api_allowed() {
        return Duration::ZERO;
    }
    match ports.gateway.assignment(&token).await {
        Ok(assignment) => set_assignment(device, assignment),
        Err(error) => {
            on_error(device, ports, error);
            return Duration::ZERO;
        }
    }
    if !device.api_allowed() {
        return Duration::ZERO;
    }
    // The open ready check is read on every connection, since its events are not replayed (RDY-11).
    match ports.gateway.my_ready_check(&token).await {
        Ok(Some(check)) => device.open_ready_check(check),
        Ok(None) => device.forget_ready_check(),
        Err(error) => on_error(device, ports, error),
    }
    if !device.api_allowed() {
        return Duration::ZERO;
    }
    let mut stream = match ports.gateway.open_stream(&token, last_id.as_deref()).await {
        Ok(stream) => stream,
        Err(error) => {
            on_error(device, ports, error);
            return Duration::ZERO;
        }
    };
    let opened = Instant::now();
    read_events(device, stream.as_mut(), last_id).await;
    opened.elapsed()
}

/// A 401 or a 426 changes the agent's state; every other failure is left to the reconnect delay.
fn on_error<G>(device: &DeviceState, ports: &StreamPorts<G>, error: ApiError) {
    device.handle_api_error(&error, ports.tokens.as_ref());
}

/// Reads the stream until it ends or the agent stops being allowed to call the API. The gateway's stream skips the events
/// it does not act on and reports why it ended; the loop only keeps the last event id for the next connection.
async fn read_events(
    device: &DeviceState,
    stream: &mut dyn EventStream,
    last_id: &mut Option<String>,
) {
    loop {
        let next = tokio::select! {
            () = device.wait_until_closed(DeviceState::api_allowed) => None,
            // The held check reached its deadline: the hotkey disarms and the loop waits for the next event (RDY-11).
            () = device.disarm_at_deadline() => Some(None),
            item = stream.next() => Some(Some(item)),
        };
        match next {
            // The agent stopped being allowed to call the API: stop reading.
            None => break,
            Some(None) => {}
            Some(Some(StreamItem::RoomAssigned(assignment))) => {
                set_assignment(device, Some(assignment));
            }
            // A ready check opened or ended for the account (RDY-01, RDY-03 … RDY-05): the hotkey follows it.
            Some(Some(StreamItem::ReadyCheckStarted(check))) => device.open_ready_check(check),
            Some(Some(StreamItem::ReadyCheckResolved(end))) => device.close_ready_check(&end.id),
            // The stream ended, failed or went silent: the caller reconnects.
            Some(Some(StreamItem::Ended(_))) => break,
        }
    }
    if let Some(id) = stream.last_event_id() {
        *last_id = Some(id.to_string());
    }
}

/// Sets or clears the current assignment and shows the room it names.
fn set_assignment(device: &DeviceState, assignment: Option<Assignment>) {
    device.replace_assignment(assignment);
    device.publish_room();
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::run;
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink, fails_fast};
    use crate::groups::StreamPorts;
    use crate::ports::{ApiError, StreamItem, TokenStore};
    use crate::secret::Secret;
    use crate::view::RoomView;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    fn assignment(game_name: &str) -> Assignment {
        Assignment {
            room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
            run: NonZeroU64::MIN,
            expected_game_name: GameName::new(game_name),
            members: Vec::new(),
        }
    }

    /// A paired device, its stream ports and the gateway they share, all in memory.
    fn paired(
        gateway: &Arc<FakeApiGateway>,
    ) -> (
        Arc<DeviceState>,
        Arc<MemoryTokens>,
        StreamPorts<FakeApiGateway>,
    ) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
        device.set_paired(true);
        let ports = StreamPorts {
            gateway: Arc::clone(gateway),
            tokens: tokens.clone(),
        };
        (device, tokens, ports)
    }

    fn calls(gateway: &FakeApiGateway) -> Vec<Call> {
        gateway.calls()
    }

    #[test]
    fn a_later_run_of_the_same_room_replaces_the_held_name_and_run() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            let mut next_run = assignment("mmbaalh-13");
            next_run.run = NonZeroU64::new(2).expect("2 is not zero");
            gateway.script_assignment([Ok(Some(assignment("mmbaalh-12")))]);
            gateway.script_open_stream([Ok(vec![StreamItem::RoomAssigned(next_run)])]);
            let (device, _tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_millis(100)).await;
            let held = device.assignment.borrow().current().cloned();
            let held = held.expect("an assignment is held");
            assert_eq!(held.expected_game_name.as_str(), "mmbaalh-13");
            assert_eq!(held.run.get(), 2, "the Party step reads for run 2");
            assert_eq!(
                held.room.as_str(),
                "7d9f2c1e-0000-4000-8000-000000000001",
                "the same room"
            );
        });
    }

    #[test]
    fn follow_fetches_assignment_then_streams() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_assignment([Ok(Some(assignment("mmbaalh-12")))]);
            gateway
                .script_open_stream([Ok(vec![StreamItem::RoomAssigned(assignment("mmbaalh-13"))])]);
            let (device, _tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(
                calls(&gateway),
                vec![
                    Call::Assignment,
                    Call::OpenStream {
                        last_event_id: None
                    }
                ],
                "the assignment is fetched before the stream opens"
            );
            assert_eq!(
                device.hub.snapshot().room,
                Some(RoomView {
                    game_name: "mmbaalh-13".to_string(),
                    needs_reveal: false,
                    matched: false,
                }),
                "the latest room.assigned wins"
            );
            assert_eq!(
                device
                    .assignment
                    .borrow()
                    .current()
                    .map(|assignment| assignment.expected_game_name.as_str().to_string()),
                Some("mmbaalh-13".to_string())
            );
        });
    }

    #[test]
    fn follow_closes_on_401_and_426() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_assignment([Ok(None), Ok(None)]);
            gateway.script_open_stream([Ok(Vec::new()), Ok(Vec::new())]);
            gateway.hold_streams();
            let (device, tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(calls(&gateway).len(), 2, "one stream is open");

            device.on_unauthorized(tokens.as_ref());
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(
                calls(&gateway).len(),
                2,
                "a 401 closes the stream and stops the requests"
            );

            tokens
                .save(&Secret::new(TOKEN))
                .expect("the memory store accepts a write");
            device.set_paired(true);
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(calls(&gateway).len(), 4, "pairing again opens a stream");

            device.on_upgrade_required(tokens.as_ref());
            tokio::time::sleep(Duration::from_secs(60)).await;
            assert_eq!(
                calls(&gateway).len(),
                4,
                "a 426 closes the stream and stops the requests"
            );
        });
    }

    /// The assignment requests the gateway has seen, one per connection attempt.
    fn assignments(gateway: &FakeApiGateway) -> usize {
        gateway
            .calls()
            .iter()
            .filter(|call| **call == Call::Assignment)
            .count()
    }

    #[test]
    fn a_failed_connection_doubles_the_reconnect_delay() {
        fails_fast(|| async {
            // Nothing is scripted, so every connection fails with `Server` and the delay runs 1 s, 2 s, 4 s.
            let gateway = Arc::new(FakeApiGateway::new());
            let (device, _tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_millis(500)).await;
            assert_eq!(assignments(&gateway), 1, "the first connection is at once");
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(assignments(&gateway), 2, "the second waits 1 s");
            tokio::time::sleep(Duration::from_secs(2)).await;
            assert_eq!(assignments(&gateway), 3, "the third waits 2 s");
            tokio::time::sleep(Duration::from_secs(3)).await;
            assert_eq!(assignments(&gateway), 3, "the fourth waits 4 s");
            tokio::time::sleep(Duration::from_secs(1)).await;
            assert_eq!(assignments(&gateway), 4, "the fourth connection is at 7 s");
        });
    }

    #[test]
    fn a_401_on_the_assignment_drops_the_token() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_assignment([Err(ApiError::Unauthorized)]);
            let (device, tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert!(tokens.load().is_none(), "a 401 forgets the token");
            assert!(!device.is_paired(), "the agent is no longer paired");
        });
    }

    #[test]
    fn a_426_on_the_assignment_raises_the_update_gate() {
        fails_fast(|| async {
            let gateway = Arc::new(FakeApiGateway::new());
            gateway.script_assignment([Err(ApiError::UpgradeRequired)]);
            let (device, _tokens, ports) = paired(&gateway);
            tokio::spawn(run(Arc::clone(&device), ports));

            tokio::time::sleep(Duration::from_secs(1)).await;
            assert!(*device.update_required.borrow(), "a 426 raises the gate");
            assert!(!device.api_allowed(), "the API loops stop");
        });
    }
}

#[cfg(test)]
mod ready_check_reads {
    use std::sync::Arc;
    use std::time::Duration;

    use super::connect_once;
    use crate::device_state::DeviceState;
    use crate::fakes::{FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::StreamPorts;
    use crate::messages::ReadyCheckOpen;
    use crate::ports::{ApiError, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    fn check(id: &str) -> ReadyCheckOpen {
        ReadyCheckOpen {
            id: id.to_string(),
            remaining: Duration::from_secs(60),
        }
    }

    fn paired(gateway: &Arc<FakeApiGateway>) -> (DeviceState, StreamPorts<FakeApiGateway>) {
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let ports = StreamPorts {
            gateway: Arc::clone(gateway),
            tokens,
        };
        (device, ports)
    }

    #[tokio::test(start_paused = true)]
    async fn a_connection_reads_the_open_check_and_holds_it() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_assignment([Ok(None)]);
        gateway.script_open_stream([Ok(Vec::new())]);
        gateway.script_my_ready_check([Ok(Some(check("rc-1")))]);
        let (device, ports) = paired(&gateway);

        let mut last_id = None;
        connect_once(&device, &ports, &mut last_id).await;

        assert_eq!(gateway.my_ready_check_reads(), 1);
        assert_eq!(device.answerable_ready_check(), Some("rc-1".to_string()));
    }

    #[tokio::test(start_paused = true)]
    async fn a_connection_that_finds_no_check_forgets_a_held_one() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_assignment([Ok(None)]);
        gateway.script_open_stream([Ok(Vec::new())]);
        gateway.script_my_ready_check([Ok(None)]);
        let (device, ports) = paired(&gateway);
        device.open_ready_check(check("rc-old"));

        let mut last_id = None;
        connect_once(&device, &ports, &mut last_id).await;

        assert!(device.answerable_ready_check().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_read_keeps_what_the_stream_said() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_assignment([Ok(None)]);
        gateway.script_open_stream([Ok(Vec::new())]);
        gateway.script_my_ready_check([Err(ApiError::Network)]);
        let (device, ports) = paired(&gateway);
        device.open_ready_check(check("rc-1"));

        let mut last_id = None;
        connect_once(&device, &ports, &mut last_id).await;

        assert!(device.answerable_ready_check().is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn an_unanswered_check_disarms_at_its_end_without_a_resolution() {
        let gateway = Arc::new(FakeApiGateway::new());
        let (device, _ports) = paired(&gateway);
        let device = Arc::new(device);
        device.open_ready_check(check("rc-1"));
        assert!(device.hub.snapshot().ready_check_open);

        let armed = tokio::spawn({
            let device = Arc::clone(&device);
            async move { device.disarm_at_deadline().await }
        });
        tokio::time::sleep(Duration::from_secs(59)).await;
        assert!(
            device.hub.snapshot().ready_check_open,
            "still open before its time runs out"
        );

        tokio::time::sleep(Duration::from_secs(2)).await;
        armed.await.expect("the disarm task finishes");
        assert!(
            !device.hub.snapshot().ready_check_open,
            "disarmed when its time ran out"
        );
    }
}
