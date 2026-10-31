//! A harness for the core loops: the fake API, the fake ports and the shared context, under a paused clock whose I/O is
//! real (see `paused`). The clock starts at the fake's wall start, so a fresh code shows "5 min".

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_core::config::{AllowLoopbackHttp, ApiBase, Config};
use d2rmm_agent_core::context::{Adapters, Context};
use d2rmm_agent_core::pairing::{self, Command};
use d2rmm_agent_core::ports::{PausedWallClock, SequentialIds};
use tokio::sync::mpsc;

use super::fake_api::{Answer, FakeApi, Operation, WALL_START};
use super::fakes::{FakeProcesses, FakeReader, FakeTokenStore, RecordingSink};
use super::paused::{RealIo, real_io};

pub const VERSION: &str = "0.0.1";
/// The clock at start: the fake's wall start.
pub const START: &str = WALL_START;

pub struct Harness {
    pub api: FakeApi,
    pub tokens: Arc<FakeTokenStore>,
    pub processes: Arc<FakeProcesses>,
    pub reader: Arc<FakeReader>,
    pub sink: Arc<RecordingSink>,
    pub ctx: Arc<Context>,
    _io: RealIo,
}

impl Harness {
    /// Starts the fake API and the core context. A token, when given, is stored before anything runs.
    pub async fn start(token: Option<&str>) -> Self {
        let io = real_io().await;
        let api = FakeApi::start().await;
        let tokens = Arc::new(FakeTokenStore::with_token(token));
        let processes = Arc::new(FakeProcesses::default());
        let reader = Arc::new(FakeReader::reading("mmbaalh-12"));
        let sink = Arc::new(RecordingSink::default());
        let config = Config {
            version: VERSION.to_string(),
            api_base: ApiBase::parse(&api.base_url(), AllowLoopbackHttp::Yes)
                .expect("the fake's loopback base"),
        };
        let adapters = Adapters {
            tokens: Arc::clone(&tokens) as _,
            processes: Arc::clone(&processes) as _,
            reader: Arc::clone(&reader) as _,
            ids: Arc::new(SequentialIds::new()),
            clock: Arc::new(PausedWallClock::starting_at(
                START.parse().expect("a valid instant"),
            )),
            sink: Arc::clone(&sink) as _,
        };
        let ctx = Context::new(&config, reqwest::Client::new(), adapters);
        Self {
            api,
            tokens,
            processes,
            reader,
            sink,
            ctx,
            _io: io,
        }
    }

    /// Runs the pairing loop and returns the sender of its commands.
    pub fn spawn_pairing(&self) -> mpsc::Sender<Command> {
        let (commands, receiver) = mpsc::channel(8);
        tokio::spawn(pairing::run(Arc::clone(&self.ctx), receiver));
        commands
    }
}

/// Moves the paused clock and lets the loops react.
pub async fn advance(by: Duration) {
    tokio::time::advance(by).await;
    settle().await;
}

/// Lets every ready task run, including requests in flight, without moving the clock.
pub async fn settle() {
    for _ in 0..20_000 {
        tokio::task::yield_now().await;
    }
}

/// Waits until `condition` holds, letting tasks run in between. Panics with `what` when it never does.
pub async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    for _ in 0..2_000_000 {
        if condition() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("timed out waiting for {what}");
}

/// Requests of `operation` received so far.
pub fn count(api: &FakeApi, operation: Operation) -> usize {
    api.requests()
        .iter()
        .filter(|request| request.operation == operation)
        .count()
}

/// `n` scripted "still pending" answers for the claim route.
pub fn pending(n: usize) -> Vec<Answer> {
    vec![Answer::Pending; n]
}
