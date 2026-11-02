//! The room the agent is assigned to (AHM-09; spec P1 "The rules live in the domain"). The API states the assignment;
//! the agent keeps only the latest one it received.

use std::num::NonZeroU64;

/// The room an assignment names. The value is opaque: the stream path checks it as before, and the fusion refuses a room
/// id that is not a UUID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomId(String);

impl RoomId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The game name the host creates in-game. The value is opaque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameName(String);

impl GameName {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A seat's role in the room.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
    Host,
    Member,
}

/// One seat of an assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub account_id: String,
    pub character_id: Option<String>,
    pub join_order: NonZeroU64,
    pub role: MemberRole,
}

/// The room and game the agent is assigned to, as the API states it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub room: RoomId,
    pub run: NonZeroU64,
    pub expected_game_name: GameName,
    pub members: Vec<Member>,
}

/// The agent's current room assignment. A newer assignment replaces the older one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomAssignment {
    current: Option<Assignment>,
}

impl RoomAssignment {
    /// No assignment yet. This is the only constructor: the type has no `Default`, so an empty slot is always spelled out.
    pub fn empty() -> Self {
        Self { current: None }
    }

    /// Stores `assignment` as the latest one. Returns `true` when it replaced an earlier assignment and `false` when the
    /// slot was empty.
    pub fn receive(&mut self, assignment: Assignment) -> bool {
        self.current.replace(assignment).is_some()
    }

    /// Forgets the current assignment.
    pub fn clear(&mut self) {
        self.current = None;
    }

    /// The latest assignment, if any.
    pub fn current(&self) -> Option<&Assignment> {
        self.current.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use super::{Assignment, GameName, RoomAssignment, RoomId};

    const ROOM_A: &str = "7d9f2c1e-0000-4000-8000-000000000001";
    const ROOM_B: &str = "7d9f2c1e-0000-4000-8000-000000000002";

    fn assignment(room: &str, game_name: &str) -> Assignment {
        Assignment {
            room: RoomId::new(room),
            run: NonZeroU64::new(1).expect("non-zero"),
            expected_game_name: GameName::new(game_name),
            members: Vec::new(),
        }
    }

    #[test]
    fn latest_assignment_wins() {
        let mut slot = RoomAssignment::empty();

        slot.receive(assignment(ROOM_A, "mmbaalh-12"));
        slot.receive(assignment(ROOM_B, "mmbaalh-13"));

        let current = slot.current().expect("an assignment is held");
        assert_eq!(current.room.as_str(), ROOM_B);
        assert_eq!(current.expected_game_name.as_str(), "mmbaalh-13");
    }

    #[test]
    fn clear_empties_the_assignment() {
        let mut slot = RoomAssignment::empty();
        slot.receive(assignment(ROOM_A, "mmbaalh-12"));

        slot.clear();

        assert!(slot.current().is_none());
    }

    #[test]
    fn receive_reports_whether_it_replaced() {
        let mut slot = RoomAssignment::empty();

        assert!(
            !slot.receive(assignment(ROOM_A, "mmbaalh-12")),
            "the first one fills an empty slot"
        );
        assert!(
            slot.receive(assignment(ROOM_B, "mmbaalh-13")),
            "the second one replaces the first"
        );
    }
}
