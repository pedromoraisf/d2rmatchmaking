//! The headless agent of the end-to-end run (OBS-24, AD-096, AGS-33). It drives the real core runtime, the real HTTP gateway
//! and the agent's span exporter, with an in-memory token store, a process source that reports the game open and a text
//! reader that returns the sidecar `<png>.txt` (Linux has no OCR). It is built only with the `fixture-read` feature.
//!
//! Arguments: `--api-base <url>` (loopback HTTP allowed) and `--read-fixture <png>`. Output: one JSON object per line with
//! the event `code`, `paired`, `assignment` or `observed`. Input: each `read` line calls `Handle::read_once` once for the
//! room the agent holds. The composition runs in `run`, over injected input and output; `main` wraps it over stdin and
//! stdout. The server trusts the token and nothing else (ADR 010): this process only sends data.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use d2rmm_agent_adapters::config::{AllowLoopbackHttp, ApiBase};
use d2rmm_agent_adapters::http::api_client::ApiClient;
use d2rmm_agent_adapters::http::client::client;
use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_adapters::telemetry::relay_client::HeaderSource;
use d2rmm_agent_adapters::telemetry::{self, ExportConfig, Mode, TelemetryGuard};
use d2rmm_agent_core::config::Config;
use d2rmm_agent_core::fakes::{MemoryTokens, NoUpdates};
use d2rmm_agent_core::groups::{
    Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
};
use d2rmm_agent_core::messages::{GameNameObservation, IssuedCode, Presence};
use d2rmm_agent_core::ports::{
    ApiError, ApiGateway, EventStream, ProcessSource, ReadError, Rgba, SequentialIds, StateSink,
    TextReader, TokenStore, WallClock,
};
use d2rmm_agent_core::runtime::{Handle, Runtime};
use d2rmm_agent_core::secret::Secret;
use d2rmm_agent_core::view::{AgentView, PairingView};
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::{ReadText, Region};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The span exporter of this run samples every trace: the run is short and its traces are the evidence.
const EXPORT_RATIO: f64 = 1.0;

/// Why the run stopped: the exit code and the line for stderr.
#[derive(Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: u8,
    pub message: String,
}

fn failure(code: u8, message: impl Into<String>) -> Failure {
    Failure {
        code,
        message: message.into(),
    }
}

/// Prints one line when the code, the pairing or the room changes, so a view published again prints nothing new.
struct Lines {
    events: UnboundedSender<Value>,
    last: Mutex<Option<AgentView>>,
}

fn code_of(view: &AgentView) -> Option<&str> {
    match &view.pairing {
        PairingView::ShowingCode { code, .. } => Some(code.as_str()),
        _ => None,
    }
}

impl StateSink for Lines {
    fn publish(&self, view: AgentView) {
        let mut last = self.last.lock().expect("the last view");
        let before = last.replace(view.clone());
        let previous_code = before.as_ref().and_then(code_of);
        if let Some(code) = code_of(&view).filter(|code| Some(*code) != previous_code) {
            let _ = self.events.send(json!({ "event": "code", "code": code }));
        }
        let was_paired = before
            .as_ref()
            .is_some_and(|previous| previous.pairing == PairingView::Paired);
        if view.pairing == PairingView::Paired && !was_paired {
            let _ = self.events.send(json!({ "event": "paired" }));
        }
        if let Some(room) = &view.room {
            let held = before.as_ref().and_then(|previous| previous.room.as_ref());
            if held != Some(room) {
                let _ = self
                    .events
                    .send(json!({ "event": "assignment", "room": room.game_name }));
            }
        }
    }
}

/// The HTTP gateway, with one line sent when the relay accepts an observation. Every other call is forwarded as is.
struct Reporting {
    inner: HttpGateway,
    events: UnboundedSender<Value>,
}

impl ApiGateway for Reporting {
    async fn request_code(&self) -> Result<IssuedCode, ApiError> {
        self.inner.request_code().await
    }

    async fn claim(&self, claim_secret: &Secret) -> Result<Secret, ApiError> {
        self.inner.claim(claim_secret).await
    }

    async fn heartbeat(
        &self,
        token: &Secret,
        presence: &Presence,
        version: &str,
    ) -> Result<(), ApiError> {
        self.inner.heartbeat(token, presence, version).await
    }

    async fn assignment(&self, token: &Secret) -> Result<Option<Assignment>, ApiError> {
        self.inner.assignment(token).await
    }

    async fn post_observation(
        &self,
        token: &Secret,
        observation: &GameNameObservation,
    ) -> Result<(), ApiError> {
        let result = self.inner.post_observation(token, observation).await;
        if result.is_ok() {
            let _ = self.events.send(json!({ "event": "observed" }));
        }
        result
    }

    async fn open_stream(
        &self,
        token: &Secret,
        last_event_id: Option<&str>,
    ) -> Result<Box<dyn EventStream>, ApiError> {
        self.inner.open_stream(token, last_event_id).await
    }
}

/// The wall clock of the run.
struct WallTime;

impl WallClock for WallTime {
    fn now_utc(&self) -> DateTime<Utc> {
        let since = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO);
        DateTime::<Utc>::from_timestamp(since.as_secs() as i64, since.subsec_nanos())
            .unwrap_or_default()
    }
}

/// The game is open: the process snapshot always names the game.
struct GameOpen;

impl ProcessSource for GameOpen {
    fn names(&self) -> Vec<String> {
        vec!["D2R.exe".to_string()]
    }
}

/// The text of the sidecar file, whatever the region: this build has no OCR (AD-096).
struct Sidecar(String);

impl TextReader for Sidecar {
    fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
        Ok(ReadText {
            text: self.0.clone(),
            confidence: 1.0,
        })
    }
}

/// The agent's token and version for each relay request, read from the store (AD-101).
struct TokenHeaders {
    tokens: std::sync::Arc<dyn TokenStore + Send + Sync>,
}

impl HeaderSource for TokenHeaders {
    fn token(&self) -> Option<Secret> {
        self.tokens.load()
    }

    fn agent_version(&self) -> String {
        VERSION.to_string()
    }
}

struct Arguments {
    api_base: String,
    fixture: PathBuf,
}

fn parse_arguments(args: &[String]) -> Result<Arguments, String> {
    let mut api_base = None;
    let mut fixture = None;
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        let value = rest.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--api-base" => api_base = Some(value.clone()),
            "--read-fixture" => fixture = Some(PathBuf::from(value)),
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(Arguments {
        api_base: api_base.ok_or("--api-base is required")?,
        fixture: fixture.ok_or("--read-fixture is required")?,
    })
}

fn decode_png(path: &Path) -> Result<Rgba, String> {
    let image = image::open(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?
        .into_rgba8();
    let (width, height) = image.dimensions();
    Ok(Rgba {
        width,
        height,
        pixels: image.into_raw(),
    })
}

/// The sidecar text of a fixture: `<png>.txt`, next to the image.
fn sidecar_path(fixture: &Path) -> PathBuf {
    let mut name = fixture.as_os_str().to_os_string();
    name.push(".txt");
    PathBuf::from(name)
}

/// Starts telemetry and the core runtime. Runs inside a tokio runtime, so the exporter and the loops attach to it.
fn start(
    api_base: &ApiBase,
    sidecar: String,
    events: UnboundedSender<Value>,
) -> Result<(Handle<Reporting>, TelemetryGuard), String> {
    let base = api_base.url().as_str().trim_end_matches('/').to_string();
    let tokens: std::sync::Arc<dyn TokenStore + Send + Sync> =
        std::sync::Arc::new(MemoryTokens::default());
    let export = ExportConfig {
        endpoint: format!("{base}/v1/telemetry/traces"),
        headers: std::sync::Arc::new(TokenHeaders {
            tokens: std::sync::Arc::clone(&tokens),
        }),
        ratio: EXPORT_RATIO,
        agent_version: VERSION.to_string(),
        environment: "headless".to_string(),
    };
    let guard = telemetry::init(Mode::Release, Some(export)).map_err(|error| error.to_string())?;

    let http = client(api_base).map_err(|error| error.to_string())?;
    let gateway = std::sync::Arc::new(Reporting {
        inner: HttpGateway::new(ApiClient::new(VERSION, api_base, http)),
        events: events.clone(),
    });
    let clock: std::sync::Arc<dyn WallClock + Send + Sync> = std::sync::Arc::new(WallTime);
    let groups = Groups {
        pairing: PairingPorts {
            gateway: std::sync::Arc::clone(&gateway),
            tokens: std::sync::Arc::clone(&tokens),
            clock: std::sync::Arc::clone(&clock),
        },
        heartbeat: HeartbeatPorts {
            gateway: std::sync::Arc::clone(&gateway),
            tokens: std::sync::Arc::clone(&tokens),
            processes: std::sync::Arc::new(GameOpen),
        },
        stream: StreamPorts {
            gateway: std::sync::Arc::clone(&gateway),
            tokens: std::sync::Arc::clone(&tokens),
        },
        update: UpdatePorts {
            updater: std::sync::Arc::new(NoUpdates),
        },
        read: ReadPorts {
            reader: std::sync::Arc::new(Sidecar(sidecar)),
            ids: std::sync::Arc::new(SequentialIds::new()),
            clock,
            gateway,
            tokens,
        },
    };
    let config = Config {
        version: VERSION.to_string(),
    };
    let sink: std::sync::Arc<dyn StateSink + Send + Sync> = std::sync::Arc::new(Lines {
        events,
        last: Mutex::new(None),
    });
    Ok((Runtime::start(&config, sink, groups), guard))
}

/// Writes each event as one line, until every sender is gone or the output fails.
async fn write_lines<W: AsyncWrite + Unpin>(mut output: W, mut received: UnboundedReceiver<Value>) {
    while let Some(event) = received.recv().await {
        let mut line = event.to_string();
        line.push('\n');
        if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err() {
            break;
        }
    }
}

/// Runs the example over `input` and `output`: arguments as in the module docs, one `read` line per read.
pub async fn run<R, W>(args: &[String], input: R, output: W) -> Result<(), Failure>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let arguments = parse_arguments(args).map_err(|message| failure(2, message))?;
    let api_base = ApiBase::parse(&arguments.api_base, AllowLoopbackHttp::Yes)
        .map_err(|error| failure(1, error.to_string()))?;
    let frame = decode_png(&arguments.fixture).map_err(|message| failure(1, message))?;
    let sidecar = std::fs::read_to_string(sidecar_path(&arguments.fixture))
        .map_err(|error| failure(1, format!("cannot read the sidecar text: {error}")))?
        .trim()
        .to_string();

    let (events, received) = mpsc::unbounded_channel();
    let writer = tokio::spawn(write_lines(output, received));
    let (handle, guard) =
        start(&api_base, sidecar, events).map_err(|message| failure(1, message))?;

    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| failure(1, error.to_string()))?
    {
        if line.trim() == "read" {
            handle.read_once(frame.clone());
        }
    }
    let _ = guard.shutdown();
    writer.abort();
    Ok(())
}

#[cfg(not(test))]
#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args, tokio::io::stdin(), tokio::io::stdout()).await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(Failure { code, message }) => {
            eprintln!("{message}");
            std::process::ExitCode::from(code)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use axum::extract::State;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use chrono::{DateTime, Utc};
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    use super::run;

    const TOKEN: &str = "d2rmm_a_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /// The routes the run calls, answered as the contract answers them. Observations are counted.
    #[derive(Clone, Default)]
    struct Fake {
        observations: Arc<AtomicUsize>,
    }

    async fn request_code() -> impl IntoResponse {
        let expires = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            + Duration::from_secs(5 * 60);
        let expires_at = DateTime::<Utc>::from_timestamp(expires.as_secs() as i64, 0);
        (
            StatusCode::CREATED,
            Json(json!({
                "code": "123456",
                "expiresAt": expires_at,
                "claimSecret": "claim-secret-fake-0001",
            })),
        )
    }

    async fn claim() -> impl IntoResponse {
        (StatusCode::OK, Json(json!({ "token": TOKEN })))
    }

    async fn heartbeat() -> impl IntoResponse {
        StatusCode::NO_CONTENT
    }

    async fn assignment() -> impl IntoResponse {
        (
            StatusCode::OK,
            Json(json!({
                "roomId": "7d9f2c1e-0000-4000-8000-000000000001",
                "run": 1,
                "expectedGameName": "mmbaalh-12",
                "members": [
                    { "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }
                ],
            })),
        )
    }

    async fn observation(State(fake): State<Fake>) -> impl IntoResponse {
        fake.observations.fetch_add(1, Ordering::SeqCst);
        (StatusCode::ACCEPTED, Json(json!({ "stored": true })))
    }

    /// Starts the fake on a free loopback port. Its base URL and the observation counter come back.
    async fn start_fake() -> (String, Arc<AtomicUsize>) {
        let fake = Fake::default();
        let observations = Arc::clone(&fake.observations);
        let router = Router::new()
            .route("/v1/agents/pairing-codes", post(request_code))
            .route("/v1/agents/pairing-codes/claim", post(claim))
            .route("/v1/agents/heartbeat", post(heartbeat))
            .route("/v1/agents/me/assignment", get(assignment))
            .route("/v1/lobby-rooms/{id}/observations", post(observation))
            .with_state(fake);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("a free loopback port");
        let base = format!(
            "http://{}",
            listener.local_addr().expect("the bound address")
        );
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (base, observations)
    }

    /// Reads the output until a line with `event` arrives; every line read on the way is kept for the failure message.
    /// The bound is a failure timeout only: the run is not timed against it.
    async fn wait_for<B: AsyncBufRead + Unpin>(
        lines: &mut tokio::io::Lines<B>,
        seen: &mut Vec<String>,
        event: &str,
    ) {
        loop {
            let line = tokio::time::timeout(Duration::from_secs(30), lines.next_line())
                .await
                .unwrap_or_else(|_| panic!("no `{event}` line; seen: {seen:?}"))
                .expect("a readable line")
                .expect("the output stays open until the input ends");
            let found = serde_json::from_str::<Value>(&line)
                .ok()
                .and_then(|value| value["event"].as_str().map(str::to_string))
                .as_deref()
                == Some(event);
            seen.push(line);
            if found {
                return;
            }
        }
    }

    #[tokio::test]
    async fn the_example_prints_its_lines_and_reads_the_sidecar_text_once() {
        let (base, observations) = start_fake().await;
        let dir = std::env::temp_dir().join(format!("d2rmm-headless-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a temporary directory");
        let fixture = dir.join("frame.png");
        // The frame must be a size with a built-in region (1920x1080, AD-047); any other size reads nothing.
        image::RgbaImage::new(1920, 1080)
            .save(&fixture)
            .expect("a PNG fixture");
        std::fs::write(format!("{}.txt", fixture.display()), "mmbaalh-12")
            .expect("the sidecar text");

        let args = [
            "--api-base".to_string(),
            base,
            "--read-fixture".to_string(),
            fixture.display().to_string(),
        ];
        let (mut typed, input) = tokio::io::duplex(1024);
        let (output, printed) = tokio::io::duplex(64 * 1024);
        let example = tokio::spawn(async move { run(&args, input, output).await });
        let mut printed = BufReader::new(printed).lines();
        let mut seen = Vec::new();

        for event in ["code", "paired", "assignment"] {
            wait_for(&mut printed, &mut seen, event).await;
        }
        typed.write_all(b"read\n").await.expect("the read line");
        wait_for(&mut printed, &mut seen, "observed").await;
        drop(typed);

        example
            .await
            .expect("the example task joins")
            .expect("the example returns Ok when its input ends");
        assert_eq!(
            observations.load(Ordering::SeqCst),
            1,
            "one read posts one observation"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
