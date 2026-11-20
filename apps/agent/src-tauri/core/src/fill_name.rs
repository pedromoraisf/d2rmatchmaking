//! Assisted typing (FR-28, AST-02 … AST-08; ADR 010). One press of the fill hotkey types the held room's game name into the
//! foreground window and stops there: the player confirms in the game. The agent types only a `TypableName`, only while D2R
//! has focus, never during a running game, and sends no other input. Every rule runs here, behind three ports.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use d2rmm_agent_domain::presence::Screen;
use d2rmm_agent_domain::typing::{Modifiers, TypableName};
use serde::Serialize;
use tokio::time::Instant;

use crate::device_state::DeviceState;
use crate::ports::{ForegroundWindow, KeyTyper, ModifierState};

/// A screen read older than this says nothing about the game now (AST-04).
const SCREEN_FRESH_FOR: Duration = Duration::from_secs(5);
/// How long the hotkey's modifier keys may stay held before the fill is refused (AST-05).
const MODIFIERS_WAIT: Duration = Duration::from_secs(1);
const MODIFIERS_POLL: Duration = Duration::from_millis(20);
/// The pause between two characters (AST-06).
const CHARACTER_PAUSE: Duration = Duration::from_millis(15);
/// A press this soon after a fill ended is ignored (AST-07).
const COOL_DOWN: Duration = Duration::from_secs(2);

/// What one fill did (AST-08, AST-10). The names are the span event's `outcome` and the window's status key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FillOutcome {
    /// Every character was typed; the player confirms in the game.
    Typed,
    StoppedFocus,
    StoppedRoom,
    StoppedPress,
    RefusedRoom,
    RefusedName,
    RefusedFocus,
    RefusedScreen,
    RefusedKeys,
}

impl FillOutcome {
    /// The outcome as the span event spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Typed => "typed",
            Self::StoppedFocus => "stopped-focus",
            Self::StoppedRoom => "stopped-room",
            Self::StoppedPress => "stopped-press",
            Self::RefusedRoom => "refused-room",
            Self::RefusedName => "refused-name",
            Self::RefusedFocus => "refused-focus",
            Self::RefusedScreen => "refused-screen",
            Self::RefusedKeys => "refused-keys",
        }
    }
}

/// The three ports a fill uses and no more (AST-06).
pub struct FillPorts {
    pub typer: Arc<dyn KeyTyper + Send + Sync>,
    pub focus: Arc<dyn ForegroundWindow + Send + Sync>,
    pub keys: Arc<dyn ModifierState + Send + Sync>,
}

enum Phase {
    Idle,
    Running(Arc<AtomicBool>),
    Done(Instant),
}

/// Whether a fill runs, and when the last one ended: the state that makes one press type once (AST-07).
pub struct FillControl {
    phase: Mutex<Phase>,
}

enum Begin {
    /// A fill runs: this press asked it to stop.
    Stopped,
    /// The last fill ended too recently.
    Ignored,
    Run(Arc<AtomicBool>),
}

impl FillControl {
    pub fn new() -> Self {
        Self {
            phase: Mutex::new(Phase::Idle),
        }
    }

    fn begin(&self) -> Begin {
        let mut phase = lock(&self.phase);
        match &*phase {
            Phase::Running(stop) => {
                stop.store(true, Ordering::SeqCst);
                Begin::Stopped
            }
            Phase::Done(ended) if ended.elapsed() < COOL_DOWN => Begin::Ignored,
            Phase::Idle | Phase::Done(_) => {
                let stop = Arc::new(AtomicBool::new(false));
                *phase = Phase::Running(Arc::clone(&stop));
                Begin::Run(stop)
            }
        }
    }

    fn end(&self) {
        *lock(&self.phase) = Phase::Done(Instant::now());
    }
}

impl Default for FillControl {
    fn default() -> Self {
        Self::new()
    }
}

/// One press of the fill hotkey. `modifiers` are the hotkey's own, which the player must let go before anything is typed.
/// `None` when the press changed nothing of its own: it stopped a fill that runs (that fill reports `StoppedPress`) or
/// came right after the last one.
pub async fn press(
    device: &DeviceState,
    ports: &FillPorts,
    control: &FillControl,
    modifiers: Modifiers,
) -> Option<FillOutcome> {
    let stop = match control.begin() {
        Begin::Stopped | Begin::Ignored => return None,
        Begin::Run(stop) => stop,
    };
    let outcome = fill(device, ports, &stop, modifiers).await;
    control.end();
    device.record_fill(outcome);
    Some(outcome)
}

async fn fill(
    device: &DeviceState,
    ports: &FillPorts,
    stop: &AtomicBool,
    modifiers: Modifiers,
) -> FillOutcome {
    let Some(held) = device.assignment.borrow().current().cloned() else {
        return FillOutcome::RefusedRoom;
    };
    let Ok(name) = TypableName::new(held.expected_game_name.as_str()) else {
        return FillOutcome::RefusedName;
    };
    if !ports.focus.game_has_focus() {
        return FillOutcome::RefusedFocus;
    }
    if matches!(
        device.recent_screen(SCREEN_FRESH_FOR),
        Some(Screen::InGame | Screen::AutomapOpen)
    ) {
        return FillOutcome::RefusedScreen;
    }
    let waited_since = Instant::now();
    while ports.keys.any_held(modifiers) {
        if stop.load(Ordering::SeqCst) {
            return FillOutcome::StoppedPress;
        }
        if waited_since.elapsed() >= MODIFIERS_WAIT {
            return FillOutcome::RefusedKeys;
        }
        tokio::time::sleep(MODIFIERS_POLL).await;
    }
    let characters = name.chars();
    for (index, character) in characters.iter().enumerate() {
        if stop.load(Ordering::SeqCst) {
            return FillOutcome::StoppedPress;
        }
        let still_held = device.assignment.borrow().current().is_some_and(|now| {
            now.room == held.room
                && now.run == held.run
                && now.expected_game_name == held.expected_game_name
        });
        if !still_held {
            return FillOutcome::StoppedRoom;
        }
        if !ports.focus.game_has_focus() {
            return if index == 0 {
                FillOutcome::RefusedFocus
            } else {
                FillOutcome::StoppedFocus
            };
        }
        ports.typer.type_char(*character);
        if index + 1 < characters.len() {
            tokio::time::sleep(CHARACTER_PAUSE).await;
        }
    }
    FillOutcome::Typed
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::typing::Modifiers;

    use super::{FillControl, FillOutcome, FillPorts, press};
    use crate::device_state::DeviceState;
    use crate::fakes::{FakeKeyboard, NullSink};

    const KEYS: Modifiers = Modifiers {
        ctrl: true,
        shift: true,
        alt: false,
    };

    fn assignment(room: &str, run: u64, name: &str) -> Assignment {
        Assignment {
            room: RoomId::new(room),
            run: NonZeroU64::new(run).expect("a run starts at 1"),
            expected_game_name: GameName::new(name),
            members: Vec::new(),
        }
    }

    struct Rig {
        device: Arc<DeviceState>,
        keyboard: Arc<FakeKeyboard>,
        ports: Arc<FillPorts>,
        control: Arc<FillControl>,
    }

    fn holding(name: Option<&str>) -> Rig {
        let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
        if let Some(name) = name {
            device.replace_assignment(Some(assignment("room-1", 1, name)));
        }
        let keyboard = Arc::new(FakeKeyboard::focused());
        let ports = Arc::new(FillPorts {
            typer: keyboard.clone(),
            focus: keyboard.clone(),
            keys: keyboard.clone(),
        });
        Rig {
            device,
            keyboard,
            ports,
            control: Arc::new(FillControl::new()),
        }
    }

    async fn one_press(rig: &Rig) -> Option<FillOutcome> {
        press(&rig.device, &rig.ports, &rig.control, KEYS).await
    }

    #[tokio::test(start_paused = true)]
    async fn a_press_types_exactly_the_held_name() {
        let rig = holding(Some("mmbaalh-12"));
        assert_eq!(one_press(&rig).await, Some(FillOutcome::Typed));
        assert_eq!(rig.keyboard.typed(), "mmbaalh-12");
    }

    #[tokio::test(start_paused = true)]
    async fn a_press_with_no_held_room_types_nothing() {
        let rig = holding(None);
        assert_eq!(one_press(&rig).await, Some(FillOutcome::RefusedRoom));
        assert_eq!(rig.keyboard.typed(), "");
    }

    #[tokio::test(start_paused = true)]
    async fn a_name_that_is_not_typable_is_never_typed() {
        for name in [
            "/exit",
            "mmbaalh-12 http://x.io",
            "MMBAALH-12",
            "mmbaalh-",
            "mmbaalh-1234567",
        ] {
            let rig = holding(Some(name));
            assert_eq!(
                one_press(&rig).await,
                Some(FillOutcome::RefusedName),
                "{name}"
            );
            assert_eq!(rig.keyboard.typed(), "", "{name}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn another_window_with_focus_gets_nothing() {
        let rig = holding(Some("mmbaalh-12"));
        rig.keyboard.set_focused(false);
        assert_eq!(one_press(&rig).await, Some(FillOutcome::RefusedFocus));
        assert_eq!(rig.keyboard.typed(), "");
    }

    #[tokio::test(start_paused = true)]
    async fn the_fill_stops_after_the_character_that_lost_focus() {
        let rig = holding(Some("mmbaalh-12"));
        rig.keyboard.lose_focus_after(3);
        assert_eq!(one_press(&rig).await, Some(FillOutcome::StoppedFocus));
        assert_eq!(rig.keyboard.typed(), "mmb");
    }

    #[tokio::test(start_paused = true)]
    async fn a_running_game_refuses_and_an_old_or_unknown_screen_allows() {
        for screen in [Screen::InGame, Screen::AutomapOpen] {
            let rig = holding(Some("mmbaalh-12"));
            rig.device.set_screen(screen);
            assert_eq!(
                one_press(&rig).await,
                Some(FillOutcome::RefusedScreen),
                "{screen:?}"
            );
            assert_eq!(rig.keyboard.typed(), "");
        }
        for screen in [Screen::CharacterSelect, Screen::Unknown] {
            let rig = holding(Some("mmbaalh-12"));
            rig.device.set_screen(screen);
            assert_eq!(
                one_press(&rig).await,
                Some(FillOutcome::Typed),
                "{screen:?}"
            );
        }
        let rig = holding(Some("mmbaalh-12"));
        rig.device.set_screen(Screen::InGame);
        tokio::time::advance(Duration::from_secs(6)).await;
        assert_eq!(
            one_press(&rig).await,
            Some(FillOutcome::Typed),
            "a 6-second-old read"
        );
        let rig = holding(Some("mmbaalh-12"));
        assert_eq!(
            one_press(&rig).await,
            Some(FillOutcome::Typed),
            "no read at all"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_screen_read_just_inside_five_seconds_still_counts() {
        let rig = holding(Some("mmbaalh-12"));
        rig.device.set_screen(Screen::InGame);
        tokio::time::advance(Duration::from_millis(4_900)).await;
        assert_eq!(one_press(&rig).await, Some(FillOutcome::RefusedScreen));
    }

    #[tokio::test(start_paused = true)]
    async fn the_fill_waits_for_the_modifiers_to_be_let_go() {
        let rig = holding(Some("mmbaalh-12"));
        rig.keyboard.hold_modifiers_for_polls(10);
        let started = tokio::time::Instant::now();
        assert_eq!(one_press(&rig).await, Some(FillOutcome::Typed));
        assert!(
            started.elapsed() >= Duration::from_millis(200),
            "waited 10 polls"
        );
        assert_eq!(rig.keyboard.typed(), "mmbaalh-12");
    }

    #[tokio::test(start_paused = true)]
    async fn modifiers_held_for_a_second_refuse_the_fill_with_nothing_typed() {
        let rig = holding(Some("mmbaalh-12"));
        rig.keyboard.hold_modifiers_forever();
        let started = tokio::time::Instant::now();
        assert_eq!(one_press(&rig).await, Some(FillOutcome::RefusedKeys));
        assert!(started.elapsed() >= Duration::from_secs(1));
        assert!(started.elapsed() < Duration::from_millis(1_100));
        assert_eq!(rig.keyboard.typed(), "");
    }

    #[tokio::test(start_paused = true)]
    async fn a_second_press_stops_the_fill_and_the_first_reports_it() {
        let rig = holding(Some("mmbaalh-12"));
        let first = {
            let (device, ports, control) = (
                Arc::clone(&rig.device),
                Arc::clone(&rig.ports),
                Arc::clone(&rig.control),
            );
            tokio::spawn(async move { press(&device, &ports, &control, KEYS).await })
        };
        // Characters go out at 0, 15, 30, 45 ms: after 40 ms the fourth is not typed yet, so three are.
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(
            one_press(&rig).await,
            None,
            "the second press has no outcome of its own"
        );
        assert_eq!(
            first.await.expect("the fill ends"),
            Some(FillOutcome::StoppedPress)
        );
        assert_eq!(rig.keyboard.typed(), "mmb");
    }

    #[tokio::test(start_paused = true)]
    async fn a_press_within_two_seconds_of_the_end_is_ignored_and_one_after_is_not() {
        let rig = holding(Some("mmbaalh-12"));
        assert_eq!(one_press(&rig).await, Some(FillOutcome::Typed));
        tokio::time::advance(Duration::from_millis(1_900)).await;
        assert_eq!(one_press(&rig).await, None);
        assert_eq!(rig.keyboard.typed(), "mmbaalh-12", "typed once");
        tokio::time::advance(Duration::from_millis(200)).await;
        assert_eq!(one_press(&rig).await, Some(FillOutcome::Typed));
        assert_eq!(rig.keyboard.typed(), "mmbaalh-12mmbaalh-12");
    }

    #[tokio::test(start_paused = true)]
    async fn the_fill_stops_when_the_room_is_dropped_or_changes() {
        for change in [
            None,
            Some(assignment("room-1", 2, "mmbaalh-13")),
            Some(assignment("room-2", 1, "mmbaalh-12")),
        ] {
            let rig = holding(Some("mmbaalh-12"));
            let first = {
                let (device, ports, control) = (
                    Arc::clone(&rig.device),
                    Arc::clone(&rig.ports),
                    Arc::clone(&rig.control),
                );
                tokio::spawn(async move { press(&device, &ports, &control, KEYS).await })
            };
            tokio::time::sleep(Duration::from_millis(40)).await;
            rig.device.replace_assignment(change);
            assert_eq!(
                first.await.expect("the fill ends"),
                Some(FillOutcome::StoppedRoom)
            );
            assert_eq!(rig.keyboard.typed(), "mmb");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn the_view_shows_the_last_outcome_and_a_press_that_did_nothing_changes_it_not() {
        let rig = holding(Some("mmbaalh-12"));
        assert_eq!(rig.device.hub.snapshot().last_fill, None);
        assert_eq!(one_press(&rig).await, Some(FillOutcome::Typed));
        assert_eq!(
            rig.device.hub.snapshot().last_fill,
            Some(FillOutcome::Typed)
        );
        rig.keyboard.set_focused(false);
        assert_eq!(one_press(&rig).await, None, "too soon");
        assert_eq!(
            rig.device.hub.snapshot().last_fill,
            Some(FillOutcome::Typed)
        );
        tokio::time::advance(Duration::from_secs(3)).await;
        assert_eq!(one_press(&rig).await, Some(FillOutcome::RefusedFocus));
        assert_eq!(
            rig.device.hub.snapshot().last_fill,
            Some(FillOutcome::RefusedFocus)
        );
    }

    #[test]
    fn the_outcomes_have_distinct_event_names() {
        let all = [
            FillOutcome::Typed,
            FillOutcome::StoppedFocus,
            FillOutcome::StoppedRoom,
            FillOutcome::StoppedPress,
            FillOutcome::RefusedRoom,
            FillOutcome::RefusedName,
            FillOutcome::RefusedFocus,
            FillOutcome::RefusedScreen,
            FillOutcome::RefusedKeys,
        ];
        let mut names: Vec<&str> = all.iter().map(|outcome| outcome.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), all.len());
    }
}
