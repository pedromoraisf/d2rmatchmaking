//! Copies the room's game name to the clipboard (FR-28, AST-11, AST-12; ADR 010). The agent writes the name of the run it
//! holds once, when the run opens, and again only when the player asks. It writes nothing but a `TypableName` (the generated
//! name shape), never reads the clipboard and sends no key to any window.

use std::num::NonZeroU64;
use std::sync::{Arc, Mutex, PoisonError};

use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::typing::TypableName;

use crate::device_state::DeviceState;
use crate::ports::Clipboard;

/// What one copy came to: a closed set of codes with no name and no text (AST-10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CopyOutcome {
    /// The run's name was written when the run opened.
    Copied,
    /// The player asked and the name was written again.
    CopiedAgain,
    /// The name is not one the agent generates, so nothing was written.
    RefusedName,
    /// The clipboard refused the write.
    Failed,
}

impl CopyOutcome {
    /// The outcome as the span event spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Copied => "copied",
            Self::CopiedAgain => "copied-again",
            Self::RefusedName => "refused-name",
            Self::Failed => "failed",
        }
    }
}

/// Which runs the agent already dealt with, so a run is copied once (AST-11). It holds the room and run, never the name.
#[derive(Debug, Default)]
pub struct CopyLedger {
    done: Mutex<Option<(String, NonZeroU64)>>,
}

impl CopyLedger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Notes the run as dealt with. `true` when it is new: the first time this room and run are seen since the ledger was
    /// last cleared.
    fn take(&self, room: &str, run: NonZeroU64) -> bool {
        let mut done = self.done.lock().unwrap_or_else(PoisonError::into_inner);
        let same = done
            .as_ref()
            .is_some_and(|(held, held_run)| held == room && *held_run == run);
        if !same {
            *done = Some((room.to_string(), run));
        }
        !same
    }

    fn clear(&self) {
        *self.done.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

/// The write of one name: refused when it is not a `TypableName`, failed when the clipboard says no.
fn write(name: &str, clipboard: &dyn Clipboard, ok: CopyOutcome) -> CopyOutcome {
    match TypableName::new(name) {
        Err(_) => CopyOutcome::RefusedName,
        Ok(name) => match clipboard.write(&name) {
            Ok(()) => ok,
            Err(_) => CopyOutcome::Failed,
        },
    }
}

/// The agent's assignment changed (AST-11). With a run the ledger has not seen, writes its name once and says how it went;
/// with the run it already dealt with, or with no assignment, writes nothing (`None`). A refused or failed run is dealt with
/// too: only the player's request tries it again. No assignment clears the ledger, so a room that opens again copies again.
pub fn on_assignment(
    assignment: Option<&Assignment>,
    clipboard: &dyn Clipboard,
    ledger: &CopyLedger,
) -> Option<CopyOutcome> {
    let Some(assignment) = assignment else {
        ledger.clear();
        return None;
    };
    if !ledger.take(assignment.room.as_str(), assignment.run) {
        return None;
    }
    Some(write(
        assignment.expected_game_name.as_str(),
        clipboard,
        CopyOutcome::Copied,
    ))
}

/// The player clicked "copy again" (AST-12): writes the held run's name once more. `None` when no room is held.
pub fn copy_again(
    assignment: Option<&Assignment>,
    clipboard: &dyn Clipboard,
) -> Option<CopyOutcome> {
    let assignment = assignment?;
    Some(write(
        assignment.expected_game_name.as_str(),
        clipboard,
        CopyOutcome::CopiedAgain,
    ))
}

/// The loop that copies: it looks at the assignment now and at every change, copies a new run once and shows the outcome. A
/// closed room clears what the window shows. It ends with the device state's channel, which lives as long as the process.
pub async fn run(
    device: Arc<DeviceState>,
    clipboard: Arc<dyn Clipboard + Send + Sync>,
    ledger: Arc<CopyLedger>,
) {
    let mut assignments = device.assignment.subscribe();
    loop {
        let (held, outcome) = {
            let slot = assignments.borrow_and_update();
            let held = slot.current().is_some();
            (
                held,
                on_assignment(slot.current(), clipboard.as_ref(), &ledger),
            )
        };
        match outcome {
            Some(outcome) => device.record_copy(outcome),
            None if !held => device.clear_copy(),
            None => {}
        }
        if assignments.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::{CopyLedger, CopyOutcome, copy_again, on_assignment};
    use crate::fakes::FakeClipboard;

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    fn run(room: &str, number: u64, name: &str) -> Assignment {
        Assignment {
            room: RoomId::new(room),
            run: NonZeroU64::new(number).expect("a run number"),
            expected_game_name: GameName::new(name),
            members: Vec::new(),
        }
    }

    #[test]
    fn a_new_run_copies_its_name_once() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        let first = run(ROOM, 1, "mmbaalh-12");

        assert_eq!(
            on_assignment(Some(&first), &clipboard, &ledger),
            Some(CopyOutcome::Copied)
        );
        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-12"));
        // The same run again (a heartbeat or a stream replay) writes nothing, even over what the player copied since.
        clipboard.replace("something else");
        assert_eq!(on_assignment(Some(&first), &clipboard, &ledger), None);
        assert_eq!(clipboard.held().as_deref(), Some("something else"));
        assert_eq!(clipboard.writes(), 1);
    }

    #[test]
    fn the_next_run_of_the_room_copies_the_new_name_once() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        on_assignment(Some(&run(ROOM, 1, "mmbaalh-12")), &clipboard, &ledger);

        let next = run(ROOM, 2, "mmbaalh-13");
        assert_eq!(
            on_assignment(Some(&next), &clipboard, &ledger),
            Some(CopyOutcome::Copied)
        );
        assert_eq!(on_assignment(Some(&next), &clipboard, &ledger), None);

        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-13"));
        assert_eq!(clipboard.writes(), 2);
    }

    #[test]
    fn another_room_with_the_same_run_number_is_a_new_run() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        on_assignment(Some(&run(ROOM, 1, "mmbaalh-12")), &clipboard, &ledger);

        let other = run("7d9f2c1e-0000-4000-8000-000000000002", 1, "mmbaalh-13");
        assert_eq!(
            on_assignment(Some(&other), &clipboard, &ledger),
            Some(CopyOutcome::Copied)
        );
    }

    #[test]
    fn a_room_that_opens_again_after_it_closed_copies_again() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        let held = run(ROOM, 1, "mmbaalh-12");
        on_assignment(Some(&held), &clipboard, &ledger);

        assert_eq!(on_assignment(None, &clipboard, &ledger), None);
        assert_eq!(
            on_assignment(Some(&held), &clipboard, &ledger),
            Some(CopyOutcome::Copied)
        );
        assert_eq!(clipboard.writes(), 2);
    }

    #[test]
    fn a_name_the_agent_does_not_generate_is_never_written() {
        for name in [
            "mmbaalh-12\n",
            "MMBAALH-12",
            "mmbaalh-12 ok",
            "/exit",
            "",
            "mmbaalh-",
            "mmbaalh-1234567",
            "mmbaalh-12\r\nhello",
        ] {
            let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
            clipboard.replace("kept");

            assert_eq!(
                on_assignment(Some(&run(ROOM, 1, name)), &clipboard, &ledger),
                Some(CopyOutcome::RefusedName),
                "{name:?}"
            );
            assert_eq!(clipboard.held().as_deref(), Some("kept"), "{name:?}");
            assert_eq!(clipboard.writes(), 0, "{name:?}");
        }
    }

    #[test]
    fn a_refused_name_is_not_tried_again_unless_the_player_asks() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        let held = run(ROOM, 1, "MMBAALH-12");
        on_assignment(Some(&held), &clipboard, &ledger);

        assert_eq!(on_assignment(Some(&held), &clipboard, &ledger), None);
        assert_eq!(
            copy_again(Some(&held), &clipboard),
            Some(CopyOutcome::RefusedName)
        );
        assert_eq!(clipboard.writes(), 0);
    }

    #[test]
    fn a_failed_write_is_reported_and_the_run_is_not_retried_by_itself() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        clipboard.set_failing(true);
        let held = run(ROOM, 1, "mmbaalh-12");

        assert_eq!(
            on_assignment(Some(&held), &clipboard, &ledger),
            Some(CopyOutcome::Failed)
        );
        clipboard.set_failing(false);
        assert_eq!(on_assignment(Some(&held), &clipboard, &ledger), None);
        assert_eq!(clipboard.held(), None);
        // The player asks, and the write that works says so.
        assert_eq!(
            copy_again(Some(&held), &clipboard),
            Some(CopyOutcome::CopiedAgain)
        );
        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-12"));
    }

    #[test]
    fn copy_again_writes_the_held_name_each_time_it_is_asked_and_nothing_with_no_room() {
        let (clipboard, ledger) = (FakeClipboard::default(), CopyLedger::new());
        let held = run(ROOM, 1, "mmbaalh-12");
        on_assignment(Some(&held), &clipboard, &ledger);
        clipboard.replace("something else");

        assert_eq!(
            copy_again(Some(&held), &clipboard),
            Some(CopyOutcome::CopiedAgain)
        );
        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-12"));
        assert_eq!(
            copy_again(Some(&held), &clipboard),
            Some(CopyOutcome::CopiedAgain)
        );
        assert_eq!(clipboard.writes(), 3);

        assert_eq!(copy_again(None, &clipboard), None);
        assert_eq!(clipboard.writes(), 3);
    }

    #[test]
    fn the_outcomes_have_the_words_the_span_event_uses() {
        let words = [
            CopyOutcome::Copied,
            CopyOutcome::CopiedAgain,
            CopyOutcome::RefusedName,
            CopyOutcome::Failed,
        ]
        .map(CopyOutcome::as_str);
        assert_eq!(words, ["copied", "copied-again", "refused-name", "failed"]);
    }
}
