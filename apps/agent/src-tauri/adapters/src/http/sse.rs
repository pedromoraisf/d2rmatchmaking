//! The server-sent event rules of the room stream (design.md § Stream and assignment; AGS-13 to AGS-15; AD-067): the
//! parser, the one event the agent acts on, the game name and `Last-Event-ID` checks, and the protocol limits. The
//! reconnect delays are domain rules and stay with the stream loop in the core.

use std::time::Duration;

use uuid::Uuid;

use crate::contracts::generated::{Assignment, RoomAssignedEventData};

/// The one stream event the agent acts on.
pub const ROOM_ASSIGNED: &str = "room.assigned";
/// The API sends `: ka` every 25 s; a stream silent for a minute is dropped.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// The largest line or event the reader accepts before it closes the connection.
pub const MAX_EVENT_BYTES: usize = 64 * 1024;

/// What a stream event does to the agent. Nothing else exists: an event cannot start a process, send input or write a
/// file (AGS-15).
#[derive(Debug, Clone)]
pub enum StreamEffect {
    SetAssignment(Assignment),
    Ignore,
}

/// Maps one stream event to its effect. Unknown names, data that fails the contract, a game name over 32 characters or
/// outside `[A-Za-z0-9-]`, and a room id that is not a UUID are all ignored (AGS-15, AD-067).
pub fn handle(name: &str, data: &str) -> StreamEffect {
    if name != ROOM_ASSIGNED {
        return StreamEffect::Ignore;
    }
    match assignment_from(data) {
        Some(assignment) => StreamEffect::SetAssignment(assignment),
        None => StreamEffect::Ignore,
    }
}

fn assignment_from(data: &str) -> Option<Assignment> {
    let event: RoomAssignedEventData = serde_json::from_str(data).ok()?;
    // The event's data and the assignment carry the same fields, so the contract's assignment type takes them as they are.
    let assignment: Assignment = serde_json::from_value(serde_json::to_value(&event).ok()?).ok()?;
    let game_name_ok = valid_game_name(assignment.expected_game_name.as_str());
    let room_ok = Uuid::parse_str(assignment.room_id.as_str()).is_ok();
    (game_name_ok && room_ok).then_some(assignment)
}

/// A game name the agent accepts: at most 32 characters of `[A-Za-z0-9-]`.
pub fn valid_game_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// A `Last-Event-ID` the agent sends: at most 32 characters of `[0-9.]`.
pub fn valid_last_event_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.')
}

/// One dispatched server-sent event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub id: Option<String>,
    pub name: String,
    pub data: String,
}

/// A line or an event is over 64 KiB: the connection is closed (design.md § Stream and assignment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a stream line or event is over 64 KiB")]
pub struct TooLarge;

/// Parses `text/event-stream` bytes incrementally. Comments and `retry:` are ignored; the last event id is kept across
/// events, as the SSE format requires.
#[derive(Debug, Default)]
pub struct SseParser {
    pending: Vec<u8>,
    event_name: Option<String>,
    data: String,
    has_data: bool,
    last_id: Option<String>,
}

impl SseParser {
    pub fn new(last_id: Option<String>) -> Self {
        Self {
            last_id,
            ..Self::default()
        }
    }

    /// Feeds bytes and returns the events they complete.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseEvent>, TooLarge> {
        let mut events = Vec::new();
        for &byte in chunk {
            if byte == b'\n' {
                let mut line = std::mem::take(&mut self.pending);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                self.line(&line, &mut events)?;
            } else {
                self.pending.push(byte);
                if self.pending.len() > MAX_EVENT_BYTES {
                    return Err(TooLarge);
                }
            }
        }
        Ok(events)
    }

    fn line(&mut self, line: &[u8], events: &mut Vec<SseEvent>) -> Result<(), TooLarge> {
        if line.is_empty() {
            self.dispatch(events);
            return Ok(());
        }
        if line.starts_with(b":") {
            return Ok(());
        }
        let (field, value) = match line.iter().position(|&byte| byte == b':') {
            Some(index) => (&line[..index], &line[index + 1..]),
            None => (line, &line[line.len()..]),
        };
        let value = value.strip_prefix(b" ").unwrap_or(value);
        let value = String::from_utf8_lossy(value).into_owned();
        match field {
            b"event" => self.event_name = Some(value),
            b"data" => {
                self.data.push_str(&value);
                self.data.push('\n');
                self.has_data = true;
                if self.data.len() > MAX_EVENT_BYTES {
                    return Err(TooLarge);
                }
            }
            b"id" if !value.contains('\0') => self.last_id = Some(value),
            _ => {}
        }
        Ok(())
    }

    fn dispatch(&mut self, events: &mut Vec<SseEvent>) {
        let name = self.event_name.take();
        if !self.has_data {
            self.data.clear();
            return;
        }
        let mut data = std::mem::take(&mut self.data);
        data.pop();
        self.has_data = false;
        events.push(SseEvent {
            id: self.last_id.clone(),
            name: name.unwrap_or_else(|| "message".to_string()),
            data,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_EVENT_BYTES, SseParser, StreamEffect, handle, valid_game_name, valid_last_event_id,
    };

    const ASSIGNED: &str = r#"{"roomId":"7d9f2c1e-0000-4000-8000-000000000001","run":1,"expectedGameName":"mmbaalh-12","members":[{"accountId":"account-1","characterId":null,"joinOrder":1,"role":"host"}]}"#;

    #[test]
    fn sse_parser_splits_events_across_chunks() {
        let mut parser = SseParser::new(None);
        let mut events = parser
            .push(b": ka\r\nid: 7\r\nevent: room.assigned\r\ndat")
            .expect("a short event parses");
        events.extend(
            parser
                .push(b"a: {\"x\":1}\r\n\r\n")
                .expect("the rest parses"),
        );

        assert_eq!(events.len(), 1, "the comment dispatches nothing");
        assert_eq!(events[0].id.as_deref(), Some("7"));
        assert_eq!(events[0].name, "room.assigned");
        assert_eq!(events[0].data, "{\"x\":1}");
    }

    #[test]
    fn sse_parser_refuses_lines_and_events_over_64_kib() {
        let mut long_line = SseParser::new(None);
        let line = format!("data: {}", "x".repeat(MAX_EVENT_BYTES));
        assert!(
            long_line.push(line.as_bytes()).is_err(),
            "one line over 64 KiB"
        );

        let mut many_lines = SseParser::new(None);
        let data_line = format!("data: {}\n", "x".repeat(1024));
        let refused = (0..80).any(|_| many_lines.push(data_line.as_bytes()).is_err());
        assert!(refused, "data lines add up to an event over 64 KiB");
    }

    #[test]
    fn last_event_id_and_game_name_rules_are_bounded() {
        assert!(valid_last_event_id("1.2"));
        assert!(!valid_last_event_id(""));
        assert!(!valid_last_event_id("x"));
        assert!(!valid_last_event_id(&"1".repeat(33)));

        assert!(valid_game_name("mmbaalh-12"));
        assert!(
            !valid_game_name(&format!("mmbaalh-{}", "1".repeat(25))),
            "33 characters"
        );
        assert!(!valid_game_name("mmbaalh_12"));
        assert!(!valid_game_name("mm baa"));
    }

    #[test]
    fn only_room_assigned_sets_an_assignment() {
        assert!(matches!(
            handle("agent.presence_changed", ASSIGNED),
            StreamEffect::Ignore
        ));
        assert!(matches!(
            handle("room.assigned", ASSIGNED),
            StreamEffect::SetAssignment(_)
        ));
        assert!(matches!(
            handle("room.assigned", "{}"),
            StreamEffect::Ignore
        ));
    }
}
