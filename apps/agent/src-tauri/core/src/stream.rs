//! The stream and assignment loop (design.md § Stream and assignment; AGS-13 to AGS-15; AD-059, AD-067).
//!
//! On pairing, start and every reconnect the agent fetches its assignment and then follows the room stream through the
//! gateway port, resuming after the last event id it saw. A dropped stream reconnects after 1 s, doubling to 60 s; a stream
//! that stayed open for 60 s resets the delay. The event rules, the parser and the protocol limits live in the adapters.

use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use tracing::Instrument;

use crate::context::Context;
use crate::messages;
use crate::ports::{ApiError, ApiGateway, EventStream, StreamItem};
use crate::view::RoomView;

/// The first reconnect delay (AD-059).
pub const RECONNECT_MIN: Duration = Duration::from_secs(1);
/// The longest reconnect delay (AD-059).
pub const RECONNECT_MAX: Duration = Duration::from_secs(60);
/// A stream open this long resets the reconnect delay (AD-059).
pub const RESET_AFTER_OPEN: Duration = Duration::from_secs(60);

/// Runs for the life of the agent, whenever it is paired and not waiting for an update.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(ctx: Arc<Context<G>>) {
    let mut delay = RECONNECT_MIN;
    let mut last_id: Option<String> = None;
    loop {
        ctx.wait_until_allowed(Context::api_allowed).await;
        let span = tracing::info_span!("agent.stream.connect");
        let open_for = connect_once(&ctx, &mut last_id).instrument(span).await;
        delay = delay_after_open(delay, open_for);
        if !ctx
            .sleep_while_allowed(Instant::now() + delay, Context::api_allowed)
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
    ctx: &Context<G>,
    last_id: &mut Option<String>,
) -> Duration {
    let Some(token) = ctx.tokens.load() else {
        return Duration::ZERO;
    };
    // A 426 that arrived since the loop last checked stops the requests (AGS-27).
    if !ctx.api_allowed() {
        return Duration::ZERO;
    }
    match ctx.gateway.assignment(&token).await {
        Ok(assignment) => set_assignment(ctx, assignment),
        Err(error) => {
            on_error(ctx, error);
            return Duration::ZERO;
        }
    }
    if !ctx.api_allowed() {
        return Duration::ZERO;
    }
    let mut stream = match ctx.gateway.open_stream(&token, last_id.as_deref()).await {
        Ok(stream) => stream,
        Err(error) => {
            on_error(ctx, error);
            return Duration::ZERO;
        }
    };
    let opened = Instant::now();
    read_events(ctx, stream.as_mut(), last_id).await;
    opened.elapsed()
}

/// A 401 or a 426 changes the agent's state; every other failure is left to the reconnect delay.
fn on_error<G>(ctx: &Context<G>, error: ApiError) {
    ctx.handle_api_error(&error);
}

/// Reads the stream until it ends or the agent stops being allowed to call the API. The gateway's stream skips the events
/// it does not act on and reports why it ended; the loop only keeps the last event id for the next connection.
async fn read_events<G>(
    ctx: &Context<G>,
    stream: &mut dyn EventStream,
    last_id: &mut Option<String>,
) {
    loop {
        let next = tokio::select! {
            () = ctx.wait_until_closed(Context::api_allowed) => None,
            item = stream.next() => Some(item),
        };
        match next {
            // The agent stopped being allowed to call the API: stop reading.
            None => break,
            Some(StreamItem::RoomAssigned(assignment)) => set_assignment(ctx, Some(assignment)),
            // The stream ended, failed or went silent: the caller reconnects.
            Some(StreamItem::Ended(_)) => break,
        }
    }
    if let Some(id) = stream.last_event_id() {
        *last_id = Some(id.to_string());
    }
}

/// Sets or clears the current assignment and shows the room it names.
fn set_assignment<G>(ctx: &Context<G>, assignment: Option<messages::Assignment>) {
    let room = assignment.as_ref().map(|assignment| RoomView {
        game_name: assignment.expected_game_name.as_str().to_string(),
    });
    ctx.assignment.send_replace(assignment);
    ctx.hub.set_room(room);
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{RECONNECT_MIN, delay_after_open, next_delay};

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
}
