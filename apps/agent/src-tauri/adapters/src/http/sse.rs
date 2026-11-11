//! The server-sent event rules of the room stream (design.md § Stream and assignment; AGS-13 to AGS-15; AD-067): the
//! parser, the one event the agent acts on, the game name and `Last-Event-ID` checks, and the protocol limits. The
//! reconnect delays are domain rules and stay with the stream loop in the core.

use std::time::Duration;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use d2rmm_agent_core::messages::{ReadyCheckEnd, ReadyCheckOpen};

use crate::contracts::generated::{
    Assignment, ReadyCheckResolvedEventData, ReadyCheckStartedEventData, RoomAssignedEventData,
};

/// The stream event the agent acts on first: the room assignment.
pub const ROOM_ASSIGNED: &str = "room.assigned";
/// A ready check opened for the account (RDY-01): the hotkey answers it until it ends.
pub const READY_CHECK_STARTED: &str = "ready_check.started";
/// A ready check ended (RDY-03 … RDY-05): the hotkey stops answering it.
pub const READY_CHECK_RESOLVED: &str = "ready_check.resolved";
/// The API sends `: ka` every 25 s; a stream silent for a minute is dropped.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// The largest line or event the reader accepts before it closes the connection.
pub const MAX_EVENT_BYTES: usize = 64 * 1024;

/// What a stream event does to the agent. Nothing else exists: an event cannot start a process, send input or write a
/// file (AGS-15).
#[derive(Debug, Clone)]
pub enum StreamEffect {
    SetAssignment(Assignment),
    ReadyCheckStarted(ReadyCheckOpen),
    ReadyCheckResolved(ReadyCheckEnd),
    Ignore,
}

/// Maps one stream event to its effect. Unknown names, data that fails the contract, a game name over 32 characters or
/// outside `[A-Za-z0-9-]`, and a room id that is not a UUID are all ignored (AGS-15, AD-067).
pub fn handle(name: &str, data: &str) -> StreamEffect {
    match name {
        ROOM_ASSIGNED => {
            assignment_from(data).map_or(StreamEffect::Ignore, StreamEffect::SetAssignment)
        }
        READY_CHECK_STARTED => ready_check_started_from(data)
            .map_or(StreamEffect::Ignore, StreamEffect::ReadyCheckStarted),
        READY_CHECK_RESOLVED => ready_check_resolved_from(data)
            .map_or(StreamEffect::Ignore, StreamEffect::ReadyCheckResolved),
        _ => StreamEffect::Ignore,
    }
}

/// The open check of `GET /v1/ready-checks/me` (RDY-11): the same view the started event carries, so it parses the same way.
pub fn ready_check_open_from_body(body: &str) -> Option<ReadyCheckOpen> {
    ready_check_started_from(body)
}

fn ready_check_started_from(data: &str) -> Option<ReadyCheckOpen> {
    let event: ReadyCheckStartedEventData = serde_json::from_str(data).ok()?;
    let deadline: DateTime<Utc> = event.deadline;
    let id = String::from(event.id);
    valid_ready_check_id(&id).then_some(ReadyCheckOpen { id, deadline })
}

fn ready_check_resolved_from(data: &str) -> Option<ReadyCheckEnd> {
    let event: ReadyCheckResolvedEventData = serde_json::from_str(data).ok()?;
    let id = String::from(event.id);
    valid_ready_check_id(&id).then_some(ReadyCheckEnd { id })
}

/// A ready-check id the agent accepts: 1 to 64 characters of `[A-Za-z0-9-]`, the contract's id as the API issues it.
pub fn valid_ready_check_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
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
        valid_ready_check_id,
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
    fn the_size_limit_is_64_kib() {
        assert_eq!(MAX_EVENT_BYTES, 65_536);
    }

    #[test]
    fn a_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused() {
        // A comment is dispatched to nothing, so only the size bound decides the outcome.
        let at_limit = format!(":{}\n", "x".repeat(MAX_EVENT_BYTES - 1));
        let mut parser = SseParser::new(None);
        assert!(
            parser.push(at_limit.as_bytes()).is_ok(),
            "a line of exactly the limit is accepted"
        );

        let one_over = format!(":{}\n", "x".repeat(MAX_EVENT_BYTES));
        let mut parser = SseParser::new(None);
        assert!(
            parser.push(one_over.as_bytes()).is_err(),
            "one byte more is refused"
        );
    }

    #[test]
    fn data_that_adds_up_to_the_limit_is_accepted_and_one_byte_more_is_refused() {
        // Each line adds its value and one newline to the event: 64 lines of 1023 bytes make exactly MAX_EVENT_BYTES.
        let line = format!("data: {}\n", "x".repeat(1023));
        let mut parser = SseParser::new(None);
        for _ in 0..64 {
            assert!(
                parser.push(line.as_bytes()).is_ok(),
                "an event of exactly the limit is accepted"
            );
        }
        assert!(parser.push(b"data:\n").is_err(), "one byte more is refused");
    }

    #[test]
    fn an_id_with_a_nul_is_ignored_and_the_last_id_stays() {
        let mut parser = SseParser::new(None);
        let events = parser
            .push(b"id: 4\ndata: a\n\nid: a\0b\ndata: b\n\n")
            .expect("both events parse");

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id.as_deref(), Some("4"));
        assert_eq!(
            events[1].id.as_deref(),
            Some("4"),
            "an id with a NUL is ignored, so Last-Event-ID is not updated"
        );
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

    const READY_CHECK: &str = r#"{"id":"rc-1","mode":"pvp","difficulty":"hell","deadline":"2026-11-10T12:01:00.000Z","now":"2026-11-10T12:00:00.000Z","members":[{"position":1,"class":"sorceress","level":91,"accepted":false,"you":true},{"position":2,"class":"barbarian","level":84,"accepted":false,"you":false}]}"#;

    #[test]
    fn a_ready_check_that_opened_gives_its_id_and_deadline() {
        let StreamEffect::ReadyCheckStarted(check) = handle("ready_check.started", READY_CHECK)
        else {
            panic!("a valid ready_check.started is held");
        };
        assert_eq!(check.id, "rc-1");
        let deadline: chrono::DateTime<chrono::Utc> =
            "2026-11-10T12:01:00Z".parse().expect("a valid instant");
        assert_eq!(check.deadline, deadline);
    }

    #[test]
    fn a_ready_check_that_ended_gives_its_id() {
        let ended = r#"{"id":"rc-1","outcome":"timed-out"}"#;
        let StreamEffect::ReadyCheckResolved(end) = handle("ready_check.resolved", ended) else {
            panic!("a valid ready_check.resolved is held");
        };
        assert_eq!(end.id, "rc-1");
    }

    #[test]
    fn a_ready_check_with_a_bad_id_or_shape_is_ignored() {
        let long_id = READY_CHECK.replace("rc-1", &"x".repeat(65));
        let spaced_id = READY_CHECK.replace("rc-1", "rc 1");
        for data in [long_id.as_str(), spaced_id.as_str(), "{}", "not json"] {
            assert!(matches!(
                handle("ready_check.started", data),
                StreamEffect::Ignore
            ));
        }
        assert!(matches!(
            handle(
                "ready_check.resolved",
                r#"{"id":"rc 1","outcome":"declined"}"#
            ),
            StreamEffect::Ignore
        ));
    }

    #[test]
    fn the_ready_check_id_rule_takes_64_characters_and_no_more() {
        assert!(valid_ready_check_id(&"a".repeat(64)));
        assert!(!valid_ready_check_id(&"a".repeat(65)));
        assert!(valid_ready_check_id("7d9f2c1e-0000-4000-8000-000000000001"));
        assert!(!valid_ready_check_id(""));
        assert!(!valid_ready_check_id("rc_1"));
    }
}
