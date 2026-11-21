//! The runtime (design.md § Runtime, state and telemetry; AGS-09, AGS-12). It builds the device state, starts the loops on
//! the caller's tokio runtime with one port group each, publishes every state change through the state sink and takes the
//! two commands the app sends: "Get a new code", and (fixture builds only, AD-057) one read of a frame.

use std::sync::Arc;

use d2rmm_agent_domain::fusion::fuse;
use d2rmm_agent_domain::remote_config::Effective;
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::typing::HotkeyPair;
use tokio::sync::{mpsc, watch};

use crate::config::Config;
use crate::device_state::DeviceState;
use crate::fill_name::{self, FillControl, FillOutcome, FillPorts};
use crate::groups::StreamPorts;
use crate::groups::{Groups, ReadPorts};
use crate::pair::{self, Command};
use crate::ports::{ApiGateway, ConfigGateway, Rgba, StateSink, TokenStore};
use crate::post_observation;
use crate::ready_check;
use crate::remote_config::{self, ConfigFetch, ConfigPorts};
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
        typing: None,
    }
}

/// What the app holds of a running agent: the commands it may send, and the ports one frame read needs.
pub struct Handle<G> {
    device: Arc<DeviceState>,
    read: Arc<ReadPorts<G>>,
    ready: Arc<StreamPorts<G>>,
    commands: mpsc::Sender<Command>,
    /// The ports and the state of assisted typing (AST-01); none until the app supplies them.
    typing: Option<Arc<Typing>>,
}

struct Typing {
    ports: FillPorts,
    control: FillControl,
}

impl<G: ApiGateway + Send + Sync + 'static> Handle<G> {
    /// Gives the handle the three ports that type the game name (AST-06). Without them `fill_name` does nothing.
    #[must_use]
    pub fn with_typing(mut self, ports: FillPorts) -> Self {
        self.typing = Some(Arc::new(Typing {
            ports,
            control: FillControl::new(),
        }));
        self
    }

    /// The fill hotkey's press (AST-01, AST-07): types the held room's game name and stops. Runs on its own task, so the
    /// window's thread never waits for the typing; the task ends with the outcome, or `None` when the press changed nothing
    /// of its own. `None` at once when the handle has no typing ports.
    ///
    /// It spawns with `tokio::spawn`, so it must be called inside the runtime's context (a task, or `Runtime::enter`): from a
    /// plain thread it panics. The app calls it from `tauri::async_runtime::spawn`.
    pub fn fill_name(&self) -> Option<tokio::task::JoinHandle<Option<FillOutcome>>> {
        let typing = Arc::clone(self.typing.as_ref()?);
        let device = Arc::clone(&self.device);
        Some(tokio::spawn(async move {
            let modifiers = device.hotkeys().fill().modifiers;
            fill_name::press(&device, &typing.ports, &typing.control, modifiers).await
        }))
    }

    /// Starts the remote configuration loop (RCF-04): the last good body is applied at once, and the API is asked once the agent is
    /// paired and then every `every`. Call it inside the runtime's context, as `with_typing`'s callers do.
    #[must_use]
    pub fn with_config<C: ConfigGateway + Send + Sync + 'static>(
        self,
        ports: ConfigPorts<C>,
        every: std::time::Duration,
    ) -> Self {
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

    /// The hotkeys the agent registers now (AST-01).
    pub fn hotkeys(&self) -> HotkeyPair {
        self.device.hotkeys()
    }

    /// Holds the hotkeys the app read from its local file (AST-01).
    pub fn set_hotkeys(&self, pair: HotkeyPair) {
        self.device.set_hotkeys(pair);
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

    use d2rmm_agent_domain::typing::{HotkeyChoice, HotkeyPair, Modifiers};

    use super::{Handle, Probe, Runtime};
    use crate::config::Config;
    use crate::device_state::DeviceState;
    use crate::fakes::{
        FakeApiGateway, FakeKeyboard, MemoryTokens, NoConsent, NoFrameReader, NoFrames,
        NoProcesses, NoText, NoUpdates, NullSink,
    };
    use crate::fill_name::{FillOutcome, FillPorts};
    use crate::groups::{
        Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
    };
    use crate::party::PartyPorts;
    use crate::ports::{SequentialIds, TokenStore, WallClock};
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

    const KEYS: Modifiers = Modifiers {
        ctrl: true,
        shift: true,
        alt: false,
    };

    fn started() -> (Handle<FakeApiGateway>, Probe, Arc<FakeKeyboard>) {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let (handle, probe) = Runtime::start_with_probe(
            &Config {
                version: "0.0.0".to_string(),
            },
            Arc::new(NullSink),
            groups(&gateway, &tokens),
        );
        let keyboard = Arc::new(FakeKeyboard::focused());
        let handle = handle.with_typing(FillPorts {
            typer: keyboard.clone(),
            focus: keyboard.clone(),
            keys: keyboard.clone(),
        });
        (handle, probe, keyboard)
    }

    #[tokio::test(start_paused = true)]
    async fn a_handle_without_typing_ports_types_nothing() {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let handle = Runtime::start(
            &Config {
                version: "0.0.0".to_string(),
            },
            Arc::new(NullSink),
            groups(&gateway, &tokens),
        );
        assert!(handle.fill_name().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn the_fill_hotkey_types_the_held_name_with_its_own_modifiers() {
        let (handle, probe, keyboard) = started();
        probe.set_assignment(Some(assignment()));

        let outcome = handle.fill_name().expect("typing is wired").await;

        assert_eq!(outcome.expect("the task ends"), Some(FillOutcome::Typed));
        assert_eq!(keyboard.typed(), "mmbaalh-12");
        assert_eq!(handle.hotkeys().fill().modifiers, KEYS);
    }

    #[tokio::test(start_paused = true)]
    async fn the_hotkeys_the_app_sets_are_held_and_shown_in_the_view() {
        let (handle, _probe, _keyboard) = started();
        assert_eq!(handle.hotkeys(), HotkeyPair::defaults());

        let pair = HotkeyPair::defaults()
            .with_fill(HotkeyChoice::parse("alt+g").expect("valid"))
            .expect("a different key");
        handle.set_hotkeys(pair);

        assert_eq!(handle.hotkeys(), pair);
        assert_eq!(handle.device.hub.snapshot().hotkeys.fill, "Alt+G");
        assert_eq!(handle.device.hub.snapshot().hotkeys.accept, "Ctrl+Shift+A");
    }
}
