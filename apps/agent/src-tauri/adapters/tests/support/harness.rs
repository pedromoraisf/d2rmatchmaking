//! A harness for the core loops: the fake API, the fake ports and the shared context, under a paused clock whose I/O is
//! real (see `paused`). The clock starts at the fake's wall start, so a fresh code shows "5 min". `ctx` is the probe the
//! assertions read; `context` is the context the loops run on, so a test starts only the loops it needs.

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_adapters::config::{AllowLoopbackHttp, ApiBase};
use d2rmm_agent_adapters::http::api_client::ApiClient;
use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_core::check_update::Updater;
use d2rmm_agent_core::config::Config;
use d2rmm_agent_core::context::{
    Context, Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
};
use d2rmm_agent_core::pair::{self, Command};
use d2rmm_agent_core::ports::{
    IdGenerator, PausedWallClock, ProcessSource, SequentialIds, TextReader, TokenStore, WallClock,
};
use d2rmm_agent_core::runtime::Probe;
use tokio::sync::mpsc;

use super::fake_api::{Answer, FakeApi, Operation, WALL_START};
use super::fakes::{FakeProcesses, FakeReader, FakeTokenStore, FakeUpdater, RecordingSink};
use super::paused::{RealIo, real_io};

pub const VERSION: &str = "0.0.1";
/// The clock at start: the fake's wall start.
pub const START: &str = WALL_START;

pub struct Harness {
    pub api: FakeApi,
    pub tokens: Arc<FakeTokenStore>,
    pub processes: Arc<FakeProcesses>,
    pub reader: Arc<FakeReader>,
    pub updater: Arc<FakeUpdater>,
    pub sink: Arc<RecordingSink>,
    /// The probe the assertions read the agent through.
    pub ctx: Probe<HttpGateway>,
    /// The context the loops run on: a test starts the loops it needs on it.
    pub context: Arc<Context<HttpGateway>>,
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
        let updater = Arc::new(FakeUpdater::default());
        let sink = Arc::new(RecordingSink::default());
        let api_base = ApiBase::parse(&api.base_url(), AllowLoopbackHttp::Yes)
            .expect("the fake's loopback base");
        let groups = fake_groups(&api_base, &tokens, &processes, &reader, &updater);
        let context = Context::from_groups(VERSION.to_string(), sink.clone(), groups);
        let ctx = Probe::over(Arc::clone(&context));
        Self {
            api,
            tokens,
            processes,
            reader,
            updater,
            sink,
            ctx,
            context,
            _io: io,
        }
    }

    /// The configuration a `Runtime` needs: the agent version. The API base travels with the gateway (`api_base`).
    pub fn config(&self) -> Config {
        Config {
            version: VERSION.to_string(),
        }
    }

    /// The API base of this harness's fake API.
    pub fn api_base(&self) -> ApiBase {
        ApiBase::parse(&self.api.base_url(), AllowLoopbackHttp::Yes)
            .expect("the fake's loopback base")
    }

    /// The five port groups a `Runtime` needs, over the same fakes this harness inspects.
    pub fn groups(&self) -> Groups<HttpGateway> {
        fake_groups(
            &self.api_base(),
            &self.tokens,
            &self.processes,
            &self.reader,
            &self.updater,
        )
    }

    /// Runs the pairing loop and returns the sender of its commands.
    pub fn spawn_pairing(&self) -> mpsc::Sender<Command> {
        let (commands, receiver) = mpsc::channel(8);
        tokio::spawn(pair::run(Arc::clone(&self.context), receiver));
        commands
    }
}

/// The five port groups over the fakes: an HTTP gateway to the fake API, the same stores and reader on every call, and a
/// fresh id generator and clock that start at the fake's wall start.
fn fake_groups(
    api_base: &ApiBase,
    tokens: &Arc<FakeTokenStore>,
    processes: &Arc<FakeProcesses>,
    reader: &Arc<FakeReader>,
    updater: &Arc<FakeUpdater>,
) -> Groups<HttpGateway> {
    let gateway = Arc::new(HttpGateway::new(ApiClient::new(
        VERSION,
        api_base,
        reqwest::Client::new(),
    )));
    let tokens_port: Arc<dyn TokenStore + Send + Sync> = Arc::clone(tokens) as _;
    let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(PausedWallClock::starting_at(
        START.parse().expect("a valid instant"),
    ));
    let processes_port: Arc<dyn ProcessSource + Send + Sync> = Arc::clone(processes) as _;
    let reader_port: Arc<dyn TextReader + Send + Sync> = Arc::clone(reader) as _;
    let updater_port: Arc<dyn Updater> = Arc::clone(updater) as _;
    let ids: Arc<dyn IdGenerator + Send + Sync> = Arc::new(SequentialIds::new());
    Groups {
        pairing: PairingPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens_port),
            clock: Arc::clone(&clock),
        },
        heartbeat: HeartbeatPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens_port),
            processes: processes_port,
        },
        stream: StreamPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens_port),
        },
        update: UpdatePorts {
            updater: updater_port,
        },
        read: ReadPorts {
            reader: reader_port,
            ids,
            clock,
            gateway,
            tokens: tokens_port,
        },
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
