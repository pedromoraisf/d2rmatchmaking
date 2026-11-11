//! The runtime (design.md § Runtime, state and telemetry; AGS-09, AGS-12). It builds the device state, starts the loops on
//! the caller's tokio runtime with one port group each, publishes every state change through the state sink and takes the
//! two commands the app sends: "Get a new code", and (fixture builds only, AD-057) one read of a frame.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use d2rmm_agent_domain::fusion::fuse;
use d2rmm_agent_domain::room_assignment::Assignment;
use tokio::sync::{mpsc, watch};

use crate::config::Config;
use crate::device_state::DeviceState;
use crate::groups::StreamPorts;
use crate::groups::{Groups, ReadPorts};
use crate::pair::{self, Command};
use crate::ports::{ApiGateway, Rgba, StateSink, TokenStore};
use crate::post_observation;
use crate::ready_check;
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
    // The held ready check's deadline is read from the platform clock (RDY-11), the same one the pairing loop uses.
    device.install_clock(Arc::clone(&pairing.clock));
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
    }
}

/// What the app holds of a running agent: the commands it may send, and the ports one frame read needs.
pub struct Handle<G> {
    device: Arc<DeviceState>,
    read: Arc<ReadPorts<G>>,
    ready: Arc<StreamPorts<G>>,
    commands: mpsc::Sender<Command>,
}

impl<G: ApiGateway + Send + Sync + 'static> Handle<G> {
    /// "Get a new code": honoured only while the pairing loop is paused (AGS-34).
    pub fn get_new_code(&self) {
        let _ = self.commands.try_send(Command::GetNewCode);
    }

    /// The hotkey's answer: accepts the held ready check when it is open at `now` (RDY-02, RDY-07). Runs on its own task, so
    /// the window's thread never waits for the API.
    pub fn accept_ready_check(&self, now: DateTime<Utc>) {
        let device = Arc::clone(&self.device);
        let ports = Arc::clone(&self.ready);
        tokio::spawn(async move {
            let _ = ready_check::accept_held(&device, &ports, now).await;
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

    use super::Probe;
    use crate::device_state::DeviceState;
    use crate::fakes::{
        FakeApiGateway, MemoryTokens, NoConsent, NoFrameReader, NoFrames, NoProcesses, NoText,
        NoUpdates, NullSink,
    };
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

    #[test]
    fn groups_build_a_device() {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(FixedClock);
        let _groups = Groups {
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
        };
        let device = DeviceState::new(Arc::new(NullSink));

        assert_eq!(device.epoch(), 0);
        assert!(!device.is_paired(), "a device starts unpaired");
        assert!(gateway.calls().is_empty(), "the gateway port is wired");
        assert!(tokens.load().is_none(), "the token store is shared");
    }
}
