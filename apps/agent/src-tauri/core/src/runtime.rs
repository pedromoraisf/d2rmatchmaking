//! The runtime (design.md § Runtime, state and telemetry; AGS-09, AGS-12). It builds the device state, starts the loops on
//! the caller's tokio runtime with one port group each, publishes every state change through the state sink and takes the
//! two commands the app sends: "Get a new code", and (fixture builds only, AD-057) one read of a frame.

use std::sync::Arc;

use d2rmm_agent_domain::fusion::fuse;
use d2rmm_agent_domain::remote_config::Effective;
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::typing::HotkeyChoice;
use tokio::sync::{mpsc, watch};

use crate::config::Config;
use crate::copy_room_name::{self, CopyLedger, CopyOutcome};
use crate::device_state::DeviceState;
use crate::groups::StreamPorts;
use crate::groups::{Groups, ReadPorts};
use crate::pair::{self, Command};
use crate::ports::{ApiGateway, Clipboard, ConfigGateway, Rgba, StateSink, TokenStore};
use crate::post_observation;
use crate::ready_check;
use crate::remote_config::{self, ConfigFetch, ConfigPorts};
use crate::view::{HotkeyFailure, HotkeyPress, HotkeySlot};
use crate::{beat, check_update, follow_stream, read_frame, watch_screen};

const COMMAND_BUFFER: usize = 8;

/// Starts the agent's loops. Call it inside a tokio runtime; the loops run until the process ends.
pub struct Runtime;

impl Runtime {
    /// Builds the device state and starts pairing, heartbeat, stream and update loops, each on its own port group.
    pub fn start<G: ApiGateway + Send + Sync + 'static>(
        config: &Config,
        sink: Arc<dyn StateSink + Send + Sync>,
        groups: Groups<G>,
    ) -> Handle<G> {
        spawn(
            config.version.clone(),
            Arc::new(DeviceState::new(sink)),
            groups,
        )
    }

    /// Like `start`, and also returns the probe the tests read and drive the agent with. The app never calls it: the probe
    /// is the only way to set the paired state or an assignment from outside the loops (AD-082).
    pub fn start_with_probe<G: ApiGateway + Send + Sync + 'static>(
        config: &Config,
        sink: Arc<dyn StateSink + Send + Sync>,
        groups: Groups<G>,
    ) -> (Handle<G>, Probe) {
        let device = Arc::new(DeviceState::new(sink));
        let probe = Probe::over(Arc::clone(&device), Arc::clone(&groups.pairing.tokens));
        (spawn(config.version.clone(), device, groups), probe)
    }
}

/// Starts the four loops on a built device state and returns the handle that keeps their command channel.
fn spawn<G: ApiGateway + Send + Sync + 'static>(
    version: String,
    device: Arc<DeviceState>,
    groups: Groups<G>,
) -> Handle<G> {
    let Groups {
        pairing,
        heartbeat,
        stream,
        update,
        read,
        screen,
    } = groups;
    let (commands, receiver) = mpsc::channel(COMMAND_BUFFER);
    // The hotkey's accept call shares the stream loop's gateway and token store (RDY-07): the same two ports, no more.
    let ready = Arc::new(StreamPorts {
        gateway: Arc::clone(&stream.gateway),
        tokens: Arc::clone(&stream.tokens),
    });
    tokio::spawn(pair::run(Arc::clone(&device), pairing, receiver));
    tokio::spawn(beat::run(Arc::clone(&device), heartbeat, version));
    tokio::spawn(follow_stream::run(Arc::clone(&device), stream));
    tokio::spawn(check_update::run(Arc::clone(&device), update));
    tokio::spawn(watch_screen::run(Arc::clone(&device), screen));
    Handle {
        device,
        read: Arc::new(read),
        ready,
        commands,
        clipboard: None,
    }
}

/// What the app holds of a running agent: the commands it may send, and the ports one frame read needs.
pub struct Handle<G> {
    device: Arc<DeviceState>,
    read: Arc<ReadPorts<G>>,
    ready: Arc<StreamPorts<G>>,
    commands: mpsc::Sender<Command>,
    /// The clipboard of the app, once it supplies one (AST-11); none until then, and `copy_again` does nothing without it.
    clipboard: Option<Arc<dyn Clipboard + Send + Sync>>,
}

impl<G: ApiGateway + Send + Sync + 'static> Handle<G> {
    /// Gives the handle the clipboard and starts the loop that copies each run's game name once (AST-11). Call it inside the
    /// runtime's context.
    #[must_use]
    pub fn with_clipboard(mut self, clipboard: Arc<dyn Clipboard + Send + Sync>) -> Self {
        tokio::spawn(copy_room_name::run(
            Arc::clone(&self.device),
            Arc::clone(&clipboard),
            Arc::new(CopyLedger::new()),
        ));
        self.clipboard = Some(clipboard);
        self
    }

    /// The player's "copy again" (AST-12): writes the held room's game name once more and shows how it went. `None` with no
    /// held room or no clipboard.
    pub fn copy_again(&self) -> Option<CopyOutcome> {
        let clipboard = self.clipboard.as_ref()?;
        let held = self.device.assignment.borrow().current().cloned();
        let outcome = copy_room_name::copy_again(held.as_ref(), clipboard.as_ref())?;
        self.device.record_copy(outcome);
        Some(outcome)
    }

    /// Starts the remote configuration loop (RCF-04): the last good body is applied at once, and the API is asked once the agent is
    /// paired and then every `every`. Call it inside the runtime's context.
    #[must_use]
    pub fn with_config<C: ConfigGateway + Send + Sync + 'static>(
        self,
        ports: ConfigPorts<C>,
        every: std::time::Duration,
    ) -> Self {
        // The last good body runs from the first look, not from the loop's first poll.
        remote_config::load_stored(&self.device, &ports);
        tokio::spawn(remote_config::run(Arc::clone(&self.device), ports, every));
        self
    }

    /// The configuration the agent runs now (RCF-08): the built-in defaults until a fetch applies a newer one.
    pub fn config(&self) -> Effective {
        self.device.config.borrow().clone()
    }

    /// Every fetch of the configuration as it ends, with a count (RCF-08, RCF-11).
    pub fn config_fetches(&self) -> watch::Receiver<ConfigFetch> {
        self.device.config_fetch.subscribe()
    }

    /// The accept hotkey the agent registers now (RDY-07).
    pub fn hotkeys(&self) -> HotkeyChoice {
        self.device.hotkeys()
    }

    /// Holds the accept hotkey the app read from its local file (RDY-07).
    pub fn set_hotkeys(&self, accept: HotkeyChoice) {
        self.device.set_hotkeys(accept);
    }

    /// Shows why the OS refused a hotkey the agent wants, or (`None`) that it holds it now (AST-08).
    pub fn set_hotkey_unavailable(&self, slot: HotkeySlot, reason: Option<HotkeyFailure>) {
        self.device.set_hotkey_unavailable(slot, reason);
    }

    /// Records a hotkey press the OS delivered: which combination it was, or that it matched none (field test of 2026-11-21).
    pub fn record_hotkey_press(&self, press: HotkeyPress) {
        self.device.record_hotkey_press(press);
    }

    /// "Get a new code": honoured only while the pairing loop is paused (AGS-34).
    pub fn get_new_code(&self) {
        let _ = self.commands.try_send(Command::GetNewCode);
    }

    /// The hotkey's answer: accepts the held ready check while its time has not run out (RDY-02, RDY-07). Runs on its own
    /// task, so the window's thread never waits for the API.
    pub fn accept_ready_check(&self) {
        let device = Arc::clone(&self.device);
        let ports = Arc::clone(&self.ready);
        tokio::spawn(async move {
            let _ = ready_check::accept_held(&device, &ports).await;
        });
    }

    /// Reads the game name from one frame and posts an observation when it names the held room. Without a held assignment
    /// nothing happens. Only the app's fixture build calls this (AD-057).
    pub fn read_once(&self, frame: Rgba) {
        let assignment = self.device.assignment.borrow().current().cloned();
        let Some(assignment) = assignment else {
            return;
        };
        let device = Arc::clone(&self.device);
        let ports = Arc::clone(&self.read);
        tokio::spawn(async move {
            let Ok(text) = read_frame::read_game_name(&frame, ports.reader.as_ref()) else {
                return;
            };
            let now = ports.clock.now_utc();
            if let Some(observation) = fuse(&text, &assignment, now, || ports.ids.idempotency_key())
            {
                post_observation::send(&device, &ports, &observation).await;
            }
        });
    }
}

/// The test probe: reads what the agent holds and drives its state directly, without a port. The loops are unchanged;
/// the probe only moves the same signals the loops read (the paired flag, the assignment, the 401 and 426 handlers).
pub struct Probe {
    /// `true` while a 426 is pending (the update gate of AGS-27).
    pub update_required: watch::Receiver<bool>,
    device: Arc<DeviceState>,
    tokens: Arc<dyn TokenStore + Send + Sync>,
}

impl Probe {
    /// A probe over a device state and its token store. The caller starts the loops it needs; `start_with_probe` starts all
    /// four.
    pub fn over(device: Arc<DeviceState>, tokens: Arc<dyn TokenStore + Send + Sync>) -> Self {
        Self {
            update_required: device.update_required.subscribe(),
            device,
            tokens,
        }
    }

    /// Observations dropped after their retries ran out or were overtaken (AD-051).
    pub fn dropped_observations(&self) -> u64 {
        self.device.dropped_observations()
    }

    /// The assignment the stream loop last set, if any.
    pub fn assignment(&self) -> Option<Assignment> {
        self.device.assignment.borrow().current().cloned()
    }

    /// Sets the paired flag the pairing and API loops read.
    pub fn set_paired(&self, paired: bool) {
        self.device.set_paired(paired);
    }

    /// Sets the assignment the observation path reads.
    pub fn set_assignment(&self, assignment: Option<Assignment>) {
        self.device.replace_assignment(assignment);
    }

    /// A 401 on any request, as the API would send it.
    pub fn on_unauthorized(&self) {
        self.device.on_unauthorized(self.tokens.as_ref());
    }

    /// A 426 on any request, as the API would send it.
    pub fn on_upgrade_required(&self) {
        self.device.on_upgrade_required(self.tokens.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;

    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use crate::copy_room_name::CopyOutcome;

    use d2rmm_agent_domain::typing::HotkeyChoice;

    use super::{Handle, Probe, Runtime};
    use crate::config::Config;
    use crate::device_state::DeviceState;
    use crate::fakes::{
        FakeApiGateway, FakeClipboard, MemoryTokens, NoConsent, NoFrameReader, NoFrames,
        NoProcesses, NoText, NoUpdates, NullSink,
    };
    use crate::groups::{
        Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
    };
    use crate::party::PartyPorts;
    use crate::ports::{SequentialIds, TokenStore, WallClock};
    use crate::view::{HotkeyFailure, HotkeyFault, HotkeyPress, HotkeySlot};
    use crate::watch_screen::ScreenPorts;

    use chrono::{DateTime, Utc};

    struct FixedClock;

    impl WallClock for FixedClock {
        fn now_utc(&self) -> DateTime<Utc> {
            "2026-10-31T10:00:00Z".parse().expect("a valid instant")
        }
    }

    fn assignment() -> Assignment {
        Assignment {
            room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
            run: NonZeroU64::MIN,
            expected_game_name: GameName::new("mmbaalh-12"),
            members: Vec::new(),
        }
    }

    #[test]
    fn probe_reads_the_agent_state_without_ports() {
        let device = Arc::new(DeviceState::new(Arc::new(NullSink)));
        let probe = Probe::over(device, Arc::new(MemoryTokens::default()));

        assert!(
            !*probe.update_required.borrow(),
            "no 426 is pending at start"
        );
        assert_eq!(probe.dropped_observations(), 0);
        assert!(probe.assignment().is_none(), "no assignment at start");

        probe.set_assignment(Some(assignment()));
        assert!(probe.assignment().is_some(), "the assignment is read back");

        probe.on_upgrade_required();
        assert!(*probe.update_required.borrow(), "a 426 raises the gate");

        probe.on_unauthorized();
        assert!(probe.assignment().is_none(), "a 401 clears the assignment");
        probe.set_paired(true);
    }

    fn groups(gateway: &Arc<FakeApiGateway>, tokens: &Arc<MemoryTokens>) -> Groups<FakeApiGateway> {
        let (gateway, tokens) = (Arc::clone(gateway), Arc::clone(tokens));
        let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(FixedClock);
        Groups {
            pairing: PairingPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
                clock: Arc::clone(&clock),
            },
            heartbeat: HeartbeatPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
                processes: Arc::new(NoProcesses),
            },
            stream: StreamPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
            },
            update: UpdatePorts {
                updater: Arc::new(NoUpdates),
            },
            read: ReadPorts {
                reader: Arc::new(NoText),
                ids: Arc::new(SequentialIds::new()),
                clock,
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
            },
            screen: ScreenPorts {
                gateway: Arc::clone(&gateway),
                tokens: tokens.clone(),
                processes: Arc::new(NoProcesses),
                frames: Arc::new(NoFrames),
                reader: Arc::new(NoFrameReader),
                consent: Arc::new(NoConsent),
                party: PartyPorts {
                    read: ReadPorts {
                        reader: Arc::new(NoText),
                        ids: Arc::new(SequentialIds::new()),
                        clock: Arc::new(FixedClock),
                        gateway: Arc::clone(&gateway),
                        tokens: tokens.clone(),
                    },
                    language: Arc::new(LanguagePack::english()),
                },
            },
        }
    }

    #[test]
    fn groups_build_a_device() {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let _groups = groups(&gateway, &tokens);
        let device = DeviceState::new(Arc::new(NullSink));

        assert_eq!(device.epoch(), 0);
        assert!(!device.is_paired(), "a device starts unpaired");
        assert!(gateway.calls().is_empty(), "the gateway port is wired");
        assert!(tokens.load().is_none(), "the token store is shared");
    }

    fn started() -> (Handle<FakeApiGateway>, Probe) {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let (handle, probe) = Runtime::start_with_probe(
            &Config {
                version: "0.0.0".to_string(),
            },
            Arc::new(NullSink),
            groups(&gateway, &tokens),
        );
        (handle, probe)
    }

    fn with_clipboard() -> (Handle<FakeApiGateway>, Probe, Arc<FakeClipboard>) {
        let (handle, probe) = started();
        let clipboard = Arc::new(FakeClipboard::default());
        (handle.with_clipboard(clipboard.clone()), probe, clipboard)
    }

    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_room_that_opens_is_copied_once_and_shown() {
        let (handle, probe, clipboard) = with_clipboard();
        settle().await;
        assert_eq!(clipboard.writes(), 0, "no room, nothing copied");

        probe.set_assignment(Some(assignment()));
        settle().await;
        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-12"));
        assert_eq!(
            handle.device.hub.snapshot().last_copy,
            Some(CopyOutcome::Copied)
        );

        // The same run stated again copies nothing more.
        probe.set_assignment(Some(assignment()));
        settle().await;
        assert_eq!(clipboard.writes(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_closed_room_clears_the_copy_line_and_copy_again_does_nothing() {
        let (handle, probe, clipboard) = with_clipboard();
        probe.set_assignment(Some(assignment()));
        settle().await;

        probe.set_assignment(None);
        settle().await;

        assert_eq!(handle.device.hub.snapshot().last_copy, None);
        assert_eq!(handle.copy_again(), None);
        assert_eq!(clipboard.writes(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn copy_again_writes_the_held_name_and_shows_it() {
        let (handle, probe, clipboard) = with_clipboard();
        probe.set_assignment(Some(assignment()));
        settle().await;
        clipboard.replace("something else");

        assert_eq!(handle.copy_again(), Some(CopyOutcome::CopiedAgain));

        assert_eq!(clipboard.held().as_deref(), Some("mmbaalh-12"));
        assert_eq!(
            handle.device.hub.snapshot().last_copy,
            Some(CopyOutcome::CopiedAgain)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_handle_without_a_clipboard_copies_nothing() {
        let (handle, probe) = started();
        probe.set_assignment(Some(assignment()));
        settle().await;
        assert_eq!(handle.copy_again(), None);
        assert_eq!(handle.device.hub.snapshot().last_copy, None);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_write_is_shown_and_a_refused_name_is_never_written() {
        let (handle, probe, clipboard) = with_clipboard();
        clipboard.set_failing(true);
        probe.set_assignment(Some(assignment()));
        settle().await;
        assert_eq!(
            handle.device.hub.snapshot().last_copy,
            Some(CopyOutcome::Failed)
        );

        clipboard.set_failing(false);
        let mut odd = assignment();
        odd.run = std::num::NonZeroU64::new(2).expect("a run number");
        odd.expected_game_name = GameName::new("MMBAALH-12");
        probe.set_assignment(Some(odd));
        settle().await;
        assert_eq!(
            handle.device.hub.snapshot().last_copy,
            Some(CopyOutcome::RefusedName)
        );
        assert_eq!(clipboard.writes(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_hotkey_the_os_refused_is_shown_with_its_reason_until_a_registration_succeeds() {
        let (handle, _probe) = started();
        assert!(handle.device.hub.snapshot().hotkey_unavailable.is_empty());
        let fault = |slot, reason| HotkeyFault { slot, reason };

        handle.set_hotkey_unavailable(HotkeySlot::Accept, Some(HotkeyFailure::Refused));
        handle.set_hotkey_unavailable(HotkeySlot::Accept, Some(HotkeyFailure::Refused));
        assert_eq!(
            handle.device.hub.snapshot().hotkey_unavailable,
            [fault(HotkeySlot::Accept, HotkeyFailure::Refused)]
        );

        handle.set_hotkey_unavailable(HotkeySlot::Accept, Some(HotkeyFailure::Dispatch));
        assert_eq!(
            handle.device.hub.snapshot().hotkey_unavailable,
            [fault(HotkeySlot::Accept, HotkeyFailure::Dispatch)]
        );

        handle.set_hotkey_unavailable(HotkeySlot::Accept, None);
        assert!(handle.device.hub.snapshot().hotkey_unavailable.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn the_last_hotkey_press_is_shown_and_absent_before_the_first() {
        let (handle, _probe) = started();
        assert_eq!(handle.device.hub.snapshot().last_press, None);
        handle.record_hotkey_press(HotkeyPress::Accept);
        assert_eq!(
            handle.device.hub.snapshot().last_press,
            Some(HotkeyPress::Accept)
        );
        handle.record_hotkey_press(HotkeyPress::Unmatched);
        assert_eq!(
            handle.device.hub.snapshot().last_press,
            Some(HotkeyPress::Unmatched)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_accept_hotkey_the_app_sets_is_held_and_shown_in_the_view() {
        let (handle, _probe) = started();
        assert_eq!(handle.hotkeys(), HotkeyChoice::default_accept());

        let accept = HotkeyChoice::parse("alt+g").expect("valid");
        handle.set_hotkeys(accept);

        assert_eq!(handle.hotkeys(), accept);
        assert_eq!(handle.device.hub.snapshot().hotkeys.accept, "Alt+G");
    }
}
