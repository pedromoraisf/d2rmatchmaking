//! In-memory fakes of the application ports, for the use-case unit tests (ADR 026, AHM-19). `FakeApiGateway` answers each
//! call from a script and records the calls. An unscripted call answers `ApiError::Server`, so a test that forgets a script
//! fails visibly. Nothing here is a mock: the fake holds plain queues and a call log.

use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::{ReadText, Region};

use crate::check_update::Updater;
use crate::messages::{GameNameObservation, IssuedCode, Presence};
use crate::ports::{
    ApiError, ApiGateway, EndReason, EventStream, ProcessSource, ReadError, Rgba, StateSink,
    StoreError, StreamItem, TextReader, TokenStore, UpdateOutcome,
};
use crate::secret::Secret;
use crate::view::AgentView;

/// One call the code under test made on the fake gateway, with the arguments the test checks.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    RequestCode,
    Claim,
    Heartbeat { presence: Presence, version: String },
    Assignment,
    PostObservation(GameNameObservation),
    OpenStream { last_event_id: Option<String> },
}

#[derive(Debug, Default)]
struct Script {
    request_code: VecDeque<Result<IssuedCode, ApiError>>,
    claim: VecDeque<Result<Secret, ApiError>>,
    heartbeat: VecDeque<Result<(), ApiError>>,
    assignment: VecDeque<Result<Option<Assignment>, ApiError>>,
    post_observation: VecDeque<Result<(), ApiError>>,
    open_stream: VecDeque<Result<Vec<StreamItem>, ApiError>>,
    hold_streams: bool,
    calls: Vec<Call>,
}

/// The API port in memory: scripted answers per route, a recorded call log.
#[derive(Debug, Default)]
pub struct FakeApiGateway {
    script: Mutex<Script>,
}

impl FakeApiGateway {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn script_request_code(
        &self,
        answers: impl IntoIterator<Item = Result<IssuedCode, ApiError>>,
    ) {
        self.with(|script| script.request_code.extend(answers));
    }

    pub fn script_claim(&self, answers: impl IntoIterator<Item = Result<Secret, ApiError>>) {
        self.with(|script| script.claim.extend(answers));
    }

    pub fn script_heartbeat(&self, answers: impl IntoIterator<Item = Result<(), ApiError>>) {
        self.with(|script| script.heartbeat.extend(answers));
    }

    pub fn script_assignment(
        &self,
        answers: impl IntoIterator<Item = Result<Option<Assignment>, ApiError>>,
    ) {
        self.with(|script| script.assignment.extend(answers));
    }

    pub fn script_post_observation(&self, answers: impl IntoIterator<Item = Result<(), ApiError>>) {
        self.with(|script| script.post_observation.extend(answers));
    }

    /// Each answer opens one stream that yields these items in order and then ends with `Closed`.
    pub fn script_open_stream(
        &self,
        answers: impl IntoIterator<Item = Result<Vec<StreamItem>, ApiError>>,
    ) {
        self.with(|script| script.open_stream.extend(answers));
    }

    /// Every stream opened from now on stays open after its scripted items, until the code under test stops reading it.
    pub fn hold_streams(&self) {
        self.with(|script| script.hold_streams = true);
    }

    /// Every call so far, in the order the code made them.
    pub fn calls(&self) -> Vec<Call> {
        self.with(|script| script.calls.clone())
    }

    fn with<T>(&self, f: impl FnOnce(&mut Script) -> T) -> T {
        let mut script = self.script.lock().expect("the fake's script lock");
        f(&mut script)
    }
}

/// The next scripted answer, or `Server` when the script has run out.
fn answer<T>(queue: &mut VecDeque<Result<T, ApiError>>) -> Result<T, ApiError> {
    queue.pop_front().unwrap_or(Err(ApiError::Server))
}

impl ApiGateway for FakeApiGateway {
    async fn request_code(&self) -> Result<IssuedCode, ApiError> {
        self.with(|script| {
            script.calls.push(Call::RequestCode);
            answer(&mut script.request_code)
        })
    }

    async fn claim(&self, _claim_secret: &Secret) -> Result<Secret, ApiError> {
        self.with(|script| {
            script.calls.push(Call::Claim);
            answer(&mut script.claim)
        })
    }

    async fn heartbeat(
        &self,
        _token: &Secret,
        presence: &Presence,
        version: &str,
    ) -> Result<(), ApiError> {
        self.with(|script| {
            script.calls.push(Call::Heartbeat {
                presence: *presence,
                version: version.to_string(),
            });
            answer(&mut script.heartbeat)
        })
    }

    async fn assignment(&self, _token: &Secret) -> Result<Option<Assignment>, ApiError> {
        self.with(|script| {
            script.calls.push(Call::Assignment);
            answer(&mut script.assignment)
        })
    }

    async fn post_observation(
        &self,
        _token: &Secret,
        observation: &GameNameObservation,
    ) -> Result<(), ApiError> {
        self.with(|script| {
            script
                .calls
                .push(Call::PostObservation(observation.clone()));
            answer(&mut script.post_observation)
        })
    }

    async fn open_stream(
        &self,
        _token: &Secret,
        last_event_id: Option<&str>,
    ) -> Result<Box<dyn EventStream>, ApiError> {
        self.with(|script| {
            let resume = last_event_id.map(str::to_string);
            script.calls.push(Call::OpenStream {
                last_event_id: resume.clone(),
            });
            let items = answer(&mut script.open_stream)?;
            let stream: Box<dyn EventStream> = Box::new(ScriptedStream {
                items: items.into(),
                last_id: resume,
                hold: script.hold_streams,
            });
            Ok(stream)
        })
    }
}

/// A stream that yields its scripted items in order, then ends with `Closed`, or stays open when the script holds streams.
/// Its last event id is the resume id it opened with, as the fake does not model event ids.
struct ScriptedStream {
    items: VecDeque<StreamItem>,
    last_id: Option<String>,
    hold: bool,
}

impl EventStream for ScriptedStream {
    fn next(&mut self) -> Pin<Box<dyn Future<Output = StreamItem> + Send + '_>> {
        Box::pin(async move {
            if let Some(item) = self.items.pop_front() {
                return item;
            }
            if self.hold {
                std::future::pending::<()>().await;
            }
            StreamItem::Ended(EndReason::Closed)
        })
    }

    fn last_event_id(&self) -> Option<&str> {
        self.last_id.as_deref()
    }
}

/// Holds the agent token in memory.
#[derive(Default)]
pub struct MemoryTokens(Mutex<Option<Secret>>);

impl TokenStore for MemoryTokens {
    fn load(&self) -> Option<Secret> {
        self.0
            .lock()
            .expect("the token lock is not poisoned")
            .clone()
    }

    fn save(&self, token: &Secret) -> Result<(), StoreError> {
        *self.0.lock().expect("the token lock is not poisoned") = Some(token.clone());
        Ok(())
    }

    fn delete(&self) {
        *self.0.lock().expect("the token lock is not poisoned") = None;
    }
}

/// A process list with no game running.
pub struct NoProcesses;

impl ProcessSource for NoProcesses {
    fn names(&self) -> Vec<String> {
        Vec::new()
    }
}

/// A text reader whose engine is unavailable: it reads nothing.
pub struct NoText;

impl TextReader for NoText {
    fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
        Err(ReadError::EngineUnavailable)
    }
}

/// An updater that reports the agent up to date.
pub struct NoUpdates;

impl Updater for NoUpdates {
    fn check_boxed(&self) -> Pin<Box<dyn Future<Output = UpdateOutcome> + Send + '_>> {
        Box::pin(async { UpdateOutcome::UpToDate })
    }
}

/// A state sink that drops every view. Tests read the agent view from `DeviceState::hub` instead.
pub struct NullSink;

impl StateSink for NullSink {
    fn publish(&self, _view: AgentView) {}
}

/// Real time a paused scenario may take before it counts as spinning (see `fails_fast`).
#[cfg(test)]
const SPIN_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

/// Runs `scenario` on a paused current-thread runtime, on a thread of its own, and fails the test when it does not finish
/// within `SPIN_BUDGET` of real time. A loop that a mutation turns into a spin never lets paused time advance, so a plain
/// `#[tokio::test]` would hang the whole test binary. This turns that hang into a failed test.
#[cfg(test)]
pub fn fails_fast<F, Fut>(scenario: F)
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = ()>,
{
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .expect("a paused runtime");
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            runtime.block_on(scenario());
        }));
        // The receiver is gone only after the timeout below has already failed the test.
        let _ = done.send(outcome);
    });
    match finished.recv_timeout(SPIN_BUDGET) {
        Ok(Ok(())) => {}
        Ok(Err(panic)) => std::panic::resume_unwind(panic),
        Err(_) => panic!(
            "the scenario did not finish within {SPIN_BUDGET:?} of real time: a loop is spinning"
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use super::{Call, FakeApiGateway};
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use crate::messages::{Presence, Screen};
    use crate::ports::{ApiError, ApiGateway, EndReason, StreamItem};
    use crate::secret::Secret;

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    fn room_assignment() -> Assignment {
        Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(1).expect("a non-zero run"),
            expected_game_name: GameName::new("mmbaalh-12"),
            members: Vec::new(),
        }
    }

    #[tokio::test]
    async fn fake_gateway_scripts_responses_and_records_calls() {
        let gateway = FakeApiGateway::new();
        gateway.script_claim([Err(ApiError::Pending), Ok(Secret::new("token-1"))]);
        gateway.script_heartbeat([Err(ApiError::Network)]);
        gateway.script_open_stream([Ok(vec![
            StreamItem::RoomAssigned(room_assignment()),
            StreamItem::Ended(EndReason::Closed),
        ])]);
        let claim = Secret::new("claim-1");
        let token = Secret::new("token-1");
        let presence = Presence {
            game_running: true,
            screen: Screen::Unknown,
        };

        assert_eq!(gateway.claim(&claim).await, Err(ApiError::Pending));
        assert_eq!(
            gateway
                .claim(&claim)
                .await
                .expect("the second claim is scripted")
                .expose(),
            "token-1"
        );
        assert_eq!(
            gateway.heartbeat(&token, &presence, "0.0.1").await,
            Err(ApiError::Network)
        );
        assert_eq!(
            gateway.assignment(&token).await,
            Err(ApiError::Server),
            "an unscripted call fails visibly"
        );

        let mut stream = gateway
            .open_stream(&token, Some("4"))
            .await
            .expect("the stream is scripted");
        assert_eq!(stream.last_event_id(), Some("4"));
        assert!(matches!(stream.next().await, StreamItem::RoomAssigned(_)));
        assert_eq!(stream.next().await, StreamItem::Ended(EndReason::Closed));

        assert_eq!(
            gateway.calls(),
            vec![
                Call::Claim,
                Call::Claim,
                Call::Heartbeat {
                    presence,
                    version: "0.0.1".to_string(),
                },
                Call::Assignment,
                Call::OpenStream {
                    last_event_id: Some("4".to_string()),
                },
            ]
        );
    }
}
