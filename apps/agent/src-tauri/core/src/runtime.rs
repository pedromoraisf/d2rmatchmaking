//! The runtime (design.md § Runtime, state and telemetry; AGS-09, AGS-12). It starts the loops on the caller's tokio
//! runtime, publishes every state change through the state sink and takes the two commands the app sends: "Get a new
//! code", and (fixture builds only, AD-057) one read of a frame.

use std::sync::Arc;

use d2rmm_agent_domain::room_assignment::Assignment;
use tokio::sync::{mpsc, watch};

use crate::config::Config;
use crate::context::{Context, Groups};
use crate::fusion::fuse;
use crate::observations;
use crate::pair::{self, Command};
use crate::ports::{ApiGateway, Rgba, StateSink};
use crate::{heartbeat, read_frame, stream, updates};

const COMMAND_BUFFER: usize = 8;

/// Starts the agent's loops. Call it inside a tokio runtime; the loops run until the process ends.
pub struct Runtime;

impl Runtime {
    /// Builds the context from the five port groups and starts pairing, heartbeat, stream and update loops.
    pub fn start<G: ApiGateway + Send + Sync + 'static>(
        config: &Config,
        sink: Arc<dyn StateSink + Send + Sync>,
        groups: Groups<G>,
    ) -> Handle<G> {
        spawn(Context::from_groups(config.version.clone(), sink, groups))
    }

    /// Like `start`, and also returns the probe the tests read and drive the agent with. The app never calls it: the probe
    /// is the only way to set the paired state or an assignment from outside the loops (AD-082).
    pub fn start_with_probe<G: ApiGateway + Send + Sync + 'static>(
        config: &Config,
        sink: Arc<dyn StateSink + Send + Sync>,
        groups: Groups<G>,
    ) -> (Handle<G>, Probe<G>) {
        let ctx = Context::from_groups(config.version.clone(), sink, groups);
        let probe = Probe::over(Arc::clone(&ctx));
        (spawn(ctx), probe)
    }
}

/// Starts the four loops on a built context and returns the handle that keeps their command channel.
fn spawn<G: ApiGateway + Send + Sync + 'static>(ctx: Arc<Context<G>>) -> Handle<G> {
    let (commands, receiver) = mpsc::channel(COMMAND_BUFFER);
    tokio::spawn(pair::run(Arc::clone(&ctx), receiver));
    tokio::spawn(heartbeat::run(Arc::clone(&ctx)));
    tokio::spawn(stream::run(Arc::clone(&ctx)));
    tokio::spawn(updates::run(Arc::clone(&ctx)));
    Handle { ctx, commands }
}

/// What the app holds of a running agent: the commands it may send.
pub struct Handle<G> {
    ctx: Arc<Context<G>>,
    commands: mpsc::Sender<Command>,
}

impl<G: ApiGateway + Send + Sync + 'static> Handle<G> {
    /// "Get a new code": honoured only while the pairing loop is paused (AGS-34).
    pub fn get_new_code(&self) {
        let _ = self.commands.try_send(Command::GetNewCode);
    }

    /// Reads the game name from one frame and posts an observation when it names the held room. Without a held assignment
    /// nothing happens. Only the app's fixture build calls this (AD-057).
    pub fn read_once(&self, frame: Rgba) {
        let assignment = self.ctx.assignment.borrow().current().cloned();
        let Some(assignment) = assignment else {
            return;
        };
        let ctx = Arc::clone(&self.ctx);
        tokio::spawn(async move {
            let Ok(read) = read_frame::read_game_name(&frame, ctx.reader.as_ref()) else {
                return;
            };
            let now = ctx.clock.now_utc();
            if let Some(fusion) = fuse(&read, &assignment, now, ctx.ids.as_ref()) {
                observations::send(&ctx, &fusion.observation).await;
            }
        });
    }
}

/// The test probe: reads what the agent holds and drives its state directly, without a port. The loops are unchanged;
/// the probe only moves the same signals the loops read (the paired flag, the assignment, the 401 and 426 handlers).
pub struct Probe<G> {
    /// `true` while a 426 is pending (the update gate of AGS-27).
    pub update_required: watch::Receiver<bool>,
    ctx: Arc<Context<G>>,
}

impl<G> Probe<G> {
    /// A probe over a context. The caller starts the loops it needs on that context; `start_with_probe` starts all four.
    pub fn over(ctx: Arc<Context<G>>) -> Self {
        Self {
            update_required: ctx.update_required.subscribe(),
            ctx,
        }
    }

    /// Observations dropped after their retries ran out or were overtaken (AD-051).
    pub fn dropped_observations(&self) -> u64 {
        self.ctx.dropped_observations()
    }

    /// The assignment the stream loop last set, if any.
    pub fn assignment(&self) -> Option<Assignment> {
        self.ctx.assignment.borrow().current().cloned()
    }

    /// Sets the paired flag the pairing and API loops read.
    pub fn set_paired(&self, paired: bool) {
        self.ctx.paired.send_replace(paired);
    }

    /// Sets the assignment the observation path reads.
    pub fn set_assignment(&self, assignment: Option<Assignment>) {
        self.ctx.replace_assignment(assignment);
    }

    /// A 401 on any request, as the API would send it.
    pub fn on_unauthorized(&self) {
        self.ctx.on_unauthorized();
    }

    /// A 426 on any request, as the API would send it.
    pub fn on_upgrade_required(&self) {
        self.ctx.on_upgrade_required();
    }
}

#[cfg(test)]
mod tests {
    use std::future::Future;
    use std::num::NonZeroU64;
    use std::pin::Pin;
    use std::sync::Arc;

    use chrono::{DateTime, Utc};

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::Probe;
    use crate::context::{
        Context, Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
    };
    use d2rmm_agent_domain::vision::{ReadText, Region};

    use crate::fakes::FakeApiGateway;
    use crate::ports::{
        ProcessSource, ReadError, Rgba, SequentialIds, StateSink, StoreError, TextReader,
        TokenStore, UpdateOutcome, WallClock,
    };
    use crate::secret::Secret;
    use crate::updates::Updater;
    use crate::view::AgentView;

    struct NoTokens;

    impl TokenStore for NoTokens {
        fn load(&self) -> Option<Secret> {
            None
        }

        fn save(&self, _token: &Secret) -> Result<(), StoreError> {
            Ok(())
        }

        fn delete(&self) {}
    }

    struct NoProcesses;

    impl ProcessSource for NoProcesses {
        fn names(&self) -> Vec<String> {
            Vec::new()
        }
    }

    struct NoText;

    impl TextReader for NoText {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::EngineUnavailable)
        }
    }

    struct NoUpdates;

    impl Updater for NoUpdates {
        fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
            Box::pin(async { UpdateOutcome::UpToDate })
        }
    }

    struct FixedClock;

    impl WallClock for FixedClock {
        fn now_utc(&self) -> DateTime<Utc> {
            "2026-10-31T10:00:00Z".parse().expect("a valid instant")
        }
    }

    struct NullSink;

    impl StateSink for NullSink {
        fn publish(&self, _view: AgentView) {}
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
        let config = crate::config::Config {
            version: "0.0.1".to_string(),
        };
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens: Arc<dyn TokenStore + Send + Sync> = Arc::new(NoTokens);
        let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(FixedClock);
        let groups = Groups {
            pairing: PairingPorts {
                gateway: Arc::clone(&gateway),
                tokens: Arc::clone(&tokens),
                clock: Arc::clone(&clock),
            },
            heartbeat: HeartbeatPorts {
                gateway: Arc::clone(&gateway),
                tokens: Arc::clone(&tokens),
                processes: Arc::new(NoProcesses),
            },
            stream: StreamPorts {
                gateway: Arc::clone(&gateway),
                tokens: Arc::clone(&tokens),
            },
            update: UpdatePorts {
                updater: Arc::new(NoUpdates),
            },
            read: ReadPorts {
                reader: Arc::new(NoText),
                ids: Arc::new(SequentialIds::new()),
                clock,
                gateway,
                tokens,
            },
        };
        let probe: Probe<FakeApiGateway> = Probe::over(Context::from_groups(
            config.version.clone(),
            Arc::new(NullSink),
            groups,
        ));

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
}
