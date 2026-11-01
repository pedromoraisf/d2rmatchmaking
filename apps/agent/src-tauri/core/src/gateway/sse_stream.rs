//! The room stream behind the `EventStream` port (design.md § Stream and assignment, `http/sse.rs`; AGS-13 to AGS-15).
//! The stream feeds the SSE parser, keeps the last event id, applies the idle timeout and the 64 KiB cap, skips every event
//! that is not a valid `room.assigned`, and reports why it ended. All state lives in `self`, so `next` is cancel-safe.

use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;

use tokio::time::timeout;

use crate::gateway::translate::assignment_from_contract;
use crate::ports::{ApiError, EndReason, EventStream, StreamItem};
use crate::stream::{IDLE_TIMEOUT, SseEvent, SseParser, StreamEffect, handle};

/// The response body ended or broke while it was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the stream broke while it was read")]
pub struct StreamBroken;

/// The body of a response, one chunk at a time. `reqwest::Response` implements it; the tests script it.
pub trait ChunkSource: Send {
    /// The next chunk: `Ok(None)` when the body ends, `Err` when reading fails. Cancel-safe.
    fn next_chunk(&mut self) -> impl Future<Output = Result<Option<Vec<u8>>, StreamBroken>> + Send;
}

impl ChunkSource for reqwest::Response {
    async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, StreamBroken> {
        reqwest::Response::chunk(self)
            .await
            .map(|chunk| chunk.map(|bytes| bytes.to_vec()))
            .map_err(|_| StreamBroken)
    }
}

/// The room stream over a chunk source. `last_event_id` starts at the id the loop resumed from and moves with every
/// event the stream dispatches.
pub struct SseEventStream<S: ChunkSource> {
    source: S,
    parser: SseParser,
    queued: VecDeque<SseEvent>,
    last_id: Option<String>,
}

impl<S: ChunkSource> SseEventStream<S> {
    pub fn new(source: S, resume: Option<String>) -> Self {
        Self {
            source,
            parser: SseParser::new(resume.clone()),
            queued: VecDeque::new(),
            last_id: resume,
        }
    }

    /// The next item that is not skipped. Every await is one chunk read, and the state changes only after a read
    /// completes, so a dropped future loses no bytes and no event.
    async fn item(&mut self) -> StreamItem {
        loop {
            if let Some(event) = self.queued.pop_front() {
                if let Some(id) = &event.id {
                    self.last_id = Some(id.clone());
                }
                match handle(&event.name, &event.data) {
                    StreamEffect::SetAssignment(assignment) => {
                        return StreamItem::RoomAssigned(assignment_from_contract(assignment));
                    }
                    StreamEffect::Ignore => continue,
                }
            }
            let chunk = match timeout(IDLE_TIMEOUT, self.source.next_chunk()).await {
                Err(_) => return StreamItem::Ended(EndReason::Idle),
                Ok(Err(_)) => return StreamItem::Ended(EndReason::Failed(ApiError::Network)),
                Ok(Ok(None)) => return StreamItem::Ended(EndReason::Closed),
                Ok(Ok(Some(chunk))) => chunk,
            };
            match self.parser.push(&chunk) {
                Ok(events) => self.queued.extend(events),
                Err(_) => return StreamItem::Ended(EndReason::Failed(ApiError::Invalid)),
            }
        }
    }
}

impl<S: ChunkSource> EventStream for SseEventStream<S> {
    fn next(&mut self) -> Pin<Box<dyn Future<Output = StreamItem> + Send + '_>> {
        Box::pin(async move { self.item().await })
    }

    fn last_event_id(&self) -> Option<&str> {
        self.last_id.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::time::Duration;

    use super::{ChunkSource, SseEventStream, StreamBroken};
    use crate::ports::{ApiError, EndReason, EventStream, StreamItem};
    use crate::stream::MAX_EVENT_BYTES;

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";
    const ASSIGNED: &str = r#"{"roomId":"7d9f2c1e-0000-4000-8000-000000000001","run":1,"expectedGameName":"mmbaalh-12","members":[{"accountId":"account-1","characterId":null,"joinOrder":1,"role":"host"}]}"#;

    /// One scripted read of the body.
    enum Step {
        Bytes(Vec<u8>),
        /// The read never completes: the connection is silent.
        Silent,
        Broken,
        End,
    }

    /// Returns the scripted reads in order; once they run out the body ends.
    struct Scripted {
        steps: VecDeque<Step>,
    }

    impl ChunkSource for Scripted {
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, StreamBroken> {
            match self.steps.pop_front().unwrap_or(Step::End) {
                Step::Bytes(bytes) => Ok(Some(bytes)),
                Step::Silent => std::future::pending().await,
                Step::Broken => Err(StreamBroken),
                Step::End => Ok(None),
            }
        }
    }

    fn stream(steps: Vec<Step>, resume: Option<&str>) -> SseEventStream<Scripted> {
        SseEventStream::new(
            Scripted {
                steps: steps.into(),
            },
            resume.map(str::to_string),
        )
    }

    /// One complete server-sent event as the wire carries it.
    fn frame(id: &str, name: &str, data: &str) -> Vec<u8> {
        format!("id: {id}\nevent: {name}\ndata: {data}\n\n").into_bytes()
    }

    #[tokio::test]
    async fn event_stream_yields_room_assigned() {
        let mut stream = stream(
            vec![
                Step::Bytes(frame("7", "room.assigned", ASSIGNED)),
                Step::End,
            ],
            None,
        );

        match stream.next().await {
            StreamItem::RoomAssigned(assignment) => {
                assert_eq!(assignment.room.as_str(), ROOM);
                assert_eq!(assignment.run.get(), 1);
                assert_eq!(assignment.expected_game_name.as_str(), "mmbaalh-12");
                assert_eq!(assignment.members.len(), 1);
            }
            other => panic!("expected the assignment, got {other:?}"),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn event_stream_ends_idle_after_sixty_seconds() {
        let mut stream = stream(vec![Step::Silent], None);
        let started = tokio::time::Instant::now();

        let item = stream.next().await;

        assert_eq!(item, StreamItem::Ended(EndReason::Idle));
        assert_eq!(started.elapsed(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn event_stream_skips_unknown_and_invalid_events() {
        let valid = ASSIGNED.replace("\"run\":1", "\"run\":5");
        let not_a_uuid = ASSIGNED.replace(ROOM, "not-a-room");
        let bad_game_name = ASSIGNED.replace("mmbaalh-12", "mm baa");
        let body = [
            frame("1", "agent.presence_changed", ASSIGNED),
            frame("2", "room.assigned", "{}"),
            frame("3", "room.assigned", &bad_game_name),
            frame("4", "room.assigned", &not_a_uuid),
            frame("5", "room.assigned", &valid),
        ]
        .concat();
        let mut stream = stream(vec![Step::Bytes(body), Step::End], None);

        match stream.next().await {
            StreamItem::RoomAssigned(assignment) => {
                assert_eq!(
                    assignment.run.get(),
                    5,
                    "the first valid event is the one returned"
                );
            }
            other => panic!("expected the valid assignment, got {other:?}"),
        }
        assert_eq!(stream.last_event_id(), Some("5"));
    }

    #[tokio::test]
    async fn event_stream_tracks_last_event_id() {
        let body = [
            frame("7", "room.assigned", ASSIGNED),
            frame("9", "agent.other", "x"),
        ]
        .concat();
        let mut stream = stream(vec![Step::Bytes(body), Step::End], Some("5"));
        assert_eq!(
            stream.last_event_id(),
            Some("5"),
            "the resume id until an event arrives"
        );

        assert!(matches!(stream.next().await, StreamItem::RoomAssigned(_)));
        assert_eq!(stream.last_event_id(), Some("7"));

        assert_eq!(stream.next().await, StreamItem::Ended(EndReason::Closed));
        assert_eq!(
            stream.last_event_id(),
            Some("9"),
            "a skipped event still moves the id"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn event_stream_next_is_cancel_safe() {
        let full = frame("3", "room.assigned", ASSIGNED);
        let (head, tail) = full.split_at(full.len() - 2);
        let mut stream = stream(
            vec![
                Step::Bytes(head.to_vec()),
                Step::Silent,
                Step::Bytes(tail.to_vec()),
                Step::End,
            ],
            None,
        );

        // The first call stops in the silent read; the timeout drops it mid-await.
        let interrupted = tokio::time::timeout(Duration::from_secs(1), stream.next()).await;
        assert!(interrupted.is_err(), "the read is still waiting");

        match stream.next().await {
            StreamItem::RoomAssigned(assignment) => {
                assert_eq!(
                    assignment.room.as_str(),
                    ROOM,
                    "the bytes read before the cancel count"
                );
            }
            other => panic!("expected the assignment after the cancel, got {other:?}"),
        }
        assert_eq!(stream.last_event_id(), Some("3"));
    }

    #[tokio::test]
    async fn event_stream_ends_failed_on_an_oversize_event() {
        let oversize = format!("data: {}\n", "x".repeat(MAX_EVENT_BYTES));
        let mut stream = stream(vec![Step::Bytes(oversize.into_bytes())], None);

        assert_eq!(
            stream.next().await,
            StreamItem::Ended(EndReason::Failed(ApiError::Invalid))
        );
    }

    #[tokio::test]
    async fn event_stream_ends_failed_when_the_body_breaks() {
        let mut stream = stream(vec![Step::Broken], None);

        assert_eq!(
            stream.next().await,
            StreamItem::Ended(EndReason::Failed(ApiError::Network))
        );
    }
}
