//! The follow-stream use case (design.md § Stream and assignment; AGS-13 to AGS-15; AD-059, AD-067).
//!
//! On pairing, start and every reconnect the agent fetches its assignment and then follows the room stream through the
//! gateway port, resuming after the last event id it saw. A dropped stream reconnects after 1 s, doubling to 60 s; a stream
//! that stayed open for 60 s resets the delay. The event rules, the parser and the protocol limits live in the adapters.

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::room_assignment::Assignment;
use tokio::time::Instant;
use tracing::Instrument;

use crate::context::StreamPorts;
use crate::device_state::DeviceState;
use crate::ports::{ApiError, ApiGateway, EventStream, StreamItem};
use crate::view::RoomView;

/// The first reconnect delay (AD-059).
pub const RECONNECT_MIN: Duration = Duration::from_secs(1);
/// The longest reconnect delay (AD-059).
pub const RECONNECT_MAX: Duration = Duration::from_secs(60);
/// A stream open this long resets the reconnect delay (AD-059).
pub const RESET_AFTER_OPEN: Duration = Duration::from_secs(60);

/// Runs for the life of the agent, whenever it is paired and not waiting for an update.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: StreamPorts<G>,
) {
    let mut delay = RECONNECT_MIN;
    let mut last_id: Option<String> = None;
    loop {
        device.wait_until_allowed(DeviceState::api_allowed).await;
        let span = tracing::info_span!("agent.stream.connect");
        let open_for = connect_once(&device, &ports, &mut last_id)
            .instrument(span)
            .await;
        delay = delay_after_open(delay, open_for);
        if !device
            .sleep_while_allowed(Instant::now() + delay, DeviceState::api_allowed)
            .await
        {
            continue;
        }
        delay = next_delay(delay);
    }
}

/// The delay before the next reconnect: a stream that stayed open for `RESET_AFTER_OPEN` starts the backoff again.
fn delay_after_open(delay: Duration, open_for: Duration) -> Duration {
    if open_for >= RESET_AFTER_OPEN {
        RECONNECT_MIN
    } else {
        delay
    }
}

/// The delay after one more failed reconnect: doubled, and never more than `RECONNECT_MAX`.
fn next_delay(delay: Duration) -> Duration {
    (delay * 2).min(RECONNECT_MAX)
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
            item = stream.next() => Some(item),
        };
        match next {
            // The agent stopped being allowed to call the API: stop reading.
            None => break,
            Some(StreamItem::RoomAssigned(assignment)) => set_assignment(device, Some(assignment)),
            // The stream ended, failed or went silent: the caller reconnects.
            Some(StreamItem::Ended(_)) => break,
        }
    }
    if let Some(id) = stream.last_event_id() {
        *last_id = Some(id.to_string());
    }
}

/// Sets or clears the current assignment and shows the room it names.
fn set_assignment(device: &DeviceState, assignment: Option<Assignment>) {
    let room = assignment.as_ref().map(|assignment| RoomView {
        game_name: assignment.expected_game_name.as_str().to_string(),
    });
    device.replace_assignment(assignment);
    device.hub.set_room(room);
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::{RECONNECT_MIN, delay_after_open, next_delay, run};
    use crate::context::StreamPorts;
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::ports::{StreamItem, TokenStore};
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
    fn reconnect_delay_doubles_to_sixty_seconds() {
        let mut delay = RECONNECT_MIN;
        let mut seen = [Duration::ZERO; 8];
        for slot in &mut seen {
            *slot = delay;
            delay = next_delay(delay);
        }
        assert_eq!(seen, [1, 2, 4, 8, 16, 32, 60, 60].map(Duration::from_secs));
    }

    #[test]
    fn reconnect_delay_resets_at_exactly_sixty_seconds_open() {
        let delay = Duration::from_secs(8);
        assert_eq!(
            delay_after_open(delay, Duration::from_millis(59_999)),
            delay
        );
        assert_eq!(
            delay_after_open(delay, Duration::from_secs(60)),
            RECONNECT_MIN
        );
        assert_eq!(
            delay_after_open(delay, Duration::from_secs(61)),
            RECONNECT_MIN
        );
    }

    #[tokio::test(start_paused = true)]
    async fn follow_fetches_assignment_then_streams() {
        let gateway = Arc::new(FakeApiGateway::new());
        gateway.script_assignment([Ok(Some(assignment("mmbaalh-12")))]);
        gateway.script_open_stream([Ok(vec![StreamItem::RoomAssigned(assignment("mmbaalh-13"))])]);
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
    }

    #[tokio::test(start_paused = true)]
    async fn follow_closes_on_401_and_426() {
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
    }
}
