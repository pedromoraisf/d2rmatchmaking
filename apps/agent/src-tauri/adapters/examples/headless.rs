//! The headless agent of the end-to-end run (OBS-24, AD-096, AGS-33). It drives the real core runtime, the real HTTP gateway
//! and the agent's span exporter, with an in-memory token store, a process source that reports the game open and a text
//! reader that returns the sidecar `<png>.txt` (Linux has no OCR). It is built only with the `fixture-read` feature.
//!
//! Arguments: `--api-base <url>` (loopback HTTP allowed), `--read-fixture <png>` or `--party-fixture <png>` (the first frame
//! the agent captures), and `--consent` (the player has given capture consent, CHR-01). Output: one JSON object per line with
//! the event `code`, `paired`, `assignment`, `observed`, `reveal` or `assignment`. Input, one command per line: `read` calls
//! `Handle::read_once` once for the room the agent holds; `show <png>` makes the agent capture that picture from now on, with
//! its sidecar `<png>.json` as the text of its regions (CHR-04, CHR-06, CHR-18); `consent on|off` gives or withdraws the
//! player's consent in the agent's window (CHR-01); `capture print|graphics good|black|failed` scripts how a capture method
//! answers and `minimize on|off` minimizes the game window (capture-cascade); a `capture` event prints when the window's
//! capture method or reason changes. The composition runs in `run`, over injected input and output; `main`
//! wraps it over stdin and stdout. The server trusts the token and nothing else (ADR 010): this process only sends data.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use d2rmm_agent_adapters::config::{AllowLoopbackHttp, ApiBase};
use d2rmm_agent_adapters::config_store::FileConfigStore;
use d2rmm_agent_adapters::http::api_client::ApiClient;
use d2rmm_agent_adapters::http::client::client;
use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_adapters::remote_config::WireReader;
use d2rmm_agent_adapters::telemetry::relay_client::HeaderSource;
use d2rmm_agent_adapters::telemetry::{self, ExportConfig, Mode, TelemetryGuard};
use d2rmm_agent_core::capturer::Capturer;
use d2rmm_agent_core::config::Config;
use d2rmm_agent_core::fakes::{MemoryTokens, NoConsent, NoFrames, NoUpdates};
use d2rmm_agent_core::fill_name::FillPorts;
use d2rmm_agent_core::groups::{
    Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
};
use d2rmm_agent_core::messages::{GameNameObservation, IssuedCode, Presence};
use d2rmm_agent_core::ports::{
    ApiError, ApiGateway, ConsentStore, EventStream, FrameSource, MethodSource, Miss,
    ProcessSource, ReadError, Rgba, SequentialIds, StateSink, StoreError, TextReader, TokenStore,
    WallClock,
};
use d2rmm_agent_core::ports::{ForegroundWindow, KeyTyper, ModifierState};
use d2rmm_agent_core::remote_config::{CHECK_EVERY, ConfigPorts, Outcome};
use d2rmm_agent_core::runtime::{Handle, Probe, Runtime};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_core::secret::Secret;
use d2rmm_agent_core::view::{AgentView, PairingView, RoomView};
use d2rmm_agent_domain::capture_cascade::CaptureMethod;
use d2rmm_agent_domain::capture_geometry::{crop_rgba, crop_to_client};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{
    PanelRegion, ScreenRegion, panel_region, screen_region, screen_text_regions,
};
use d2rmm_agent_domain::remote_config::Effective;
use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
use d2rmm_agent_domain::typing::{Modifiers, TypableChar};
use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};
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
        // The capture lines of the window (capture-cascade CAP-02, CAP-07): printed when the method or the reason changes.
        let capture_of = |view: &AgentView| {
            view.capture
                .as_ref()
                .map(|capture| (capture.method, capture.reason))
        };
        if let Some((method, reason)) =
            capture_of(&view).filter(|now| Some(*now) != before.as_ref().and_then(capture_of))
        {
            let _ = self
                .events
                .send(json!({ "event": "capture", "method": method, "reason": reason }));
        }
        let hinted =
            |room: Option<&RoomView>| room.is_some_and(|room| room.needs_reveal && !room.matched);
        if hinted(view.room.as_ref())
            && !hinted(before.as_ref().and_then(|previous| previous.room.as_ref()))
        {
            let _ = self
                .events
                .send(json!({ "event": "reveal", "text": REVEAL_TEXT }));
        }
        // The window drops the room line when the room ends (ARL-01) and says "presence confirmed" once the API accepts the
        // run (ARL-03): the acceptance scenarios read both here.
        let held_before = before.as_ref().and_then(|previous| previous.room.as_ref());
        if held_before.is_some() && view.room.is_none() {
            let _ = self.events.send(json!({ "event": "room-dropped" }));
        }
        if view.room.as_ref().is_some_and(|room| room.confirmed)
            && !held_before.is_some_and(|room| room.confirmed)
        {
            let _ = self.events.send(json!({ "event": "presence-confirmed" }));
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

    async fn post_characters(
        &self,
        token: &Secret,
        cards: &[d2rmm_agent_domain::characters::Card],
    ) -> Result<(), ApiError> {
        self.inner.post_characters(token, cards).await
    }

    async fn open_stream(
        &self,
        token: &Secret,
        last_event_id: Option<&str>,
    ) -> Result<Box<dyn EventStream>, ApiError> {
        self.inner.open_stream(token, last_event_id).await
    }

    async fn accept_ready_check(&self, token: &Secret, check_id: &str) -> Result<(), ApiError> {
        self.inner.accept_ready_check(token, check_id).await
    }

    async fn my_ready_check(
        &self,
        token: &Secret,
    ) -> Result<Option<d2rmm_agent_core::messages::ReadyCheckOpen>, ApiError> {
        self.inner.my_ready_check(token).await
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

/// The text the window shows when the Party panel shows the masked game name (AGN-04). The example prints it as the `reveal`
/// event, so the acceptance steps read what the player would be told.
const REVEAL_TEXT: &str = "Open the Party panel (P) and click the eye to show the game name.";

/// The frame the agent captures and the sidecar (`<png>.json`) its text comes from. `show <png>` and the first fixture replace
/// both; `None` until a frame is shown, so a capture before then is no capture (the game window is not there).
pub struct Shot {
    frame: Rgba,
    sidecar: PathBuf,
}

/// The shown frame, shared by the capture, the text reader and the input loop of one run.
type SharedShot = std::sync::Arc<Mutex<Option<Shot>>>;

/// The key of the sidecar that holds the text of `region` in `image`: a Party panel region (`partyTitle`, `gameNameLabel`,
/// `gameNameField`, AGN-02) or a character screen region (`cardName3`, `createNew`…, CHR-06). `None` for any other region.
pub fn region_key(image: &Rgba, region: Region) -> Option<String> {
    let panel = [
        (PanelRegion::PartyTitle, "partyTitle"),
        (PanelRegion::GameNameLabel, "gameNameLabel"),
        (PanelRegion::GameNameField, "gameNameField"),
    ]
    .into_iter()
    .find(|(panel, _)| panel_region(*panel, image.width, image.height) == Some(region))
    .map(|(_, key)| key.to_string());
    panel.or_else(|| {
        screen_text_regions()
            .into_iter()
            .find(|screen| screen_region(*screen, image.width, image.height) == Some(region))
            .map(ScreenRegion::key)
    })
}

/// The text of `region` in the sidecar of a shown frame, or `None` when the sidecar holds no text for it.
fn sidecar_text(sidecar: &Path, image: &Rgba, region: Region) -> Option<String> {
    let key = region_key(image, region)?;
    let text = std::fs::read_to_string(sidecar).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The text of each region of the shown frame, read from its sidecar. The sidecar is read again on every call, so the
/// acceptance steps change what the game shows while the agent runs.
struct ShownText(SharedShot);

impl ShownText {
    fn sidecar(&self) -> Result<PathBuf, ReadError> {
        let shown = self.0.lock().map_err(|_| ReadError::Failed)?;
        shown
            .as_ref()
            .map(|shot| shot.sidecar.clone())
            .ok_or(ReadError::Failed)
    }
}

/// The sidecar keys that are markers: read at their region, never found as lines.
const MARKER_KEYS: [&str; 3] = ["createNew", "life", "areaDifficulty"];

/// The lines a sidecar shows: every key that names a Party panel or a character screen region, with the text it holds and
/// the box of its region in `image` (the drawn fixtures put each text in the box of its region). Markers are not lines.
fn sidecar_lines(sidecar: &Path, image: &Rgba) -> Vec<TextLine> {
    let Some(value) = std::fs::read_to_string(sidecar)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    else {
        return Vec::new();
    };
    let panels = [
        (PanelRegion::PartyTitle, "partyTitle"),
        (PanelRegion::GameNameLabel, "gameNameLabel"),
        (PanelRegion::GameNameField, "gameNameField"),
    ]
    .into_iter()
    .filter_map(|(panel, key)| {
        Some((
            key.to_string(),
            panel_region(panel, image.width, image.height)?,
        ))
    });
    let screens = screen_text_regions().into_iter().filter_map(|screen| {
        Some((
            screen.key(),
            screen_region(screen, image.width, image.height)?,
        ))
    });
    let keyed = panels
        .chain(screens)
        .filter(|(key, _)| !MARKER_KEYS.contains(&key.as_str()))
        .filter_map(|(key, region)| {
            let text = value.get(&key)?.as_str()?;
            (!text.trim().is_empty()).then(|| TextLine {
                text: text.to_string(),
                region,
            })
        });
    // The lines a sidecar draws at their own boxes (`"lines": [{ "text", "x", "y", "width", "height" }]`, the shape of the
    // full-screen and per-mode fixtures): the screens the fixed regions do not reach, read by the word search.
    let boxed = value
        .get("lines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let number = |key: &str| u32::try_from(line.get(key)?.as_u64()?).ok();
            Some(TextLine {
                text: line.get("text")?.as_str()?.to_string(),
                region: Region {
                    x: number("x")?,
                    y: number("y")?,
                    width: number("width")?,
                    height: number("height")?,
                },
            })
        });
    keyed.chain(boxed).collect()
}

fn holds(area: Region, line: &TextLine) -> bool {
    let (x, y) = (line.region.middle_x(), line.region.middle_y());
    area.x <= x && x < area.right() && area.y <= y && y < area.bottom()
}

impl TextReader for ShownText {
    /// A marker answers its own text; any other region answers the lines whose middle it holds, and blank when it holds none
    /// (the masked value's dots read as nothing).
    fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
        let sidecar = self.sidecar()?;
        if let Some(text) = sidecar_text(&sidecar, image, region) {
            return Ok(ReadText {
                text,
                confidence: 1.0,
            });
        }
        let text = sidecar_lines(&sidecar, image)
            .iter()
            .filter(|line| holds(region, line))
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        Ok(ReadText {
            text,
            confidence: 1.0,
        })
    }

    fn read_lines(&self, image: &Rgba, area: Region) -> Vec<TextLine> {
        let Ok(sidecar) = self.sidecar() else {
            return Vec::new();
        };
        sidecar_lines(&sidecar, image)
            .into_iter()
            .filter(|line| holds(area, line))
            .collect()
    }
}

/// What a scripted capture method returns (the `capture` input lines): the shown frame, a black frame of its size, or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Behaviour {
    Good,
    Black,
    Failed,
}

impl Behaviour {
    const fn code(self) -> u8 {
        match self {
            Self::Good => 0,
            Self::Black => 1,
            Self::Failed => 2,
        }
    }

    const fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Black,
            2 => Self::Failed,
            _ => Self::Good,
        }
    }
}

/// How the scripted game window behaves, switched by the `capture` and `minimize` input lines.
#[derive(Default)]
pub struct Script {
    print_window: AtomicU8,
    graphics_capture: AtomicU8,
    minimized: AtomicBool,
}

impl Script {
    fn behaviour_of(&self, method: CaptureMethod) -> Behaviour {
        let slot = match method {
            CaptureMethod::PrintWindow => &self.print_window,
            _ => &self.graphics_capture,
        };
        Behaviour::from_code(slot.load(Ordering::SeqCst))
    }

    fn set(&self, method: CaptureMethod, behaviour: Behaviour) {
        let slot = match method {
            CaptureMethod::PrintWindow => &self.print_window,
            _ => &self.graphics_capture,
        };
        slot.store(behaviour.code(), Ordering::SeqCst);
    }
}

/// The client area a sidecar names: `client` (a rectangle inside a frame that holds a title bar), which the capture crops to,
/// or `clientSize` (what the window reports, with the frame left as it is, so a frame of another size is refused).
fn client_of(sidecar: &Value) -> Option<((u32, u32), (u32, u32))> {
    let number = |value: &Value, key: &str| u32::try_from(value.get(key)?.as_u64()?).ok();
    if let Some(client) = sidecar.get("client") {
        return Some((
            (number(client, "x")?, number(client, "y")?),
            (number(client, "width")?, number(client, "height")?),
        ));
    }
    let size = sidecar.get("clientSize")?;
    Some(((0, 0), (number(size, "width")?, number(size, "height")?)))
}

/// The capture methods of the example, scripted: both return the shown picture (cropped to its client area when the sidecar
/// names one), a black frame or nothing, as the `capture` lines say. No picture shown, or a minimized window, is no game window.
struct ScriptedMethods {
    shared: SharedShot,
    script: std::sync::Arc<Script>,
}

impl ScriptedMethods {
    fn sidecar_value(&self) -> Option<Value> {
        let shown = self.shared.lock().ok()?;
        let text = std::fs::read_to_string(&shown.as_ref()?.sidecar).ok()?;
        serde_json::from_str(&text).ok()
    }
}

impl MethodSource for ScriptedMethods {
    fn methods(&self) -> Vec<CaptureMethod> {
        vec![CaptureMethod::PrintWindow, CaptureMethod::GraphicsCapture]
    }

    fn capture_with(&self, method: CaptureMethod) -> Result<Rgba, Miss> {
        if self.script.minimized.load(Ordering::SeqCst) {
            return Err(Miss::NoWindow);
        }
        let shown = self.shared.lock().map_err(|_| Miss::Failed)?;
        let frame = shown.as_ref().ok_or(Miss::NoWindow)?.frame.clone();
        drop(shown);
        // A sidecar with a `client` rectangle describes a frame that holds a title bar: the capture keeps the client area only.
        let sidecar = self.sidecar_value();
        let frame = match sidecar
            .as_ref()
            .filter(|sidecar| sidecar.get("client").is_some())
        {
            Some(sidecar) => {
                let (offset, size) = client_of(sidecar).ok_or(Miss::Failed)?;
                let rect = crop_to_client((frame.width, frame.height), offset, size)
                    .ok_or(Miss::Failed)?;
                Rgba {
                    width: rect.width,
                    height: rect.height,
                    pixels: crop_rgba(&frame.pixels, frame.width, rect).ok_or(Miss::Failed)?,
                }
            }
            None => frame,
        };
        match self.script.behaviour_of(method) {
            Behaviour::Good => Ok(frame),
            Behaviour::Black => Ok(Rgba {
                pixels: vec![0; frame.pixels.len()],
                ..frame
            }),
            Behaviour::Failed => Err(Miss::Failed),
        }
    }

    fn client_size(&self) -> Option<(u32, u32)> {
        // The sidecar's client rectangle or reported client size, else the shown picture's own size (a window with no title bar).
        if let Some((_, size)) = self.sidecar_value().as_ref().and_then(client_of) {
            return Some(size);
        }
        let shown = self.shared.lock().ok()?;
        shown
            .as_ref()
            .map(|shot| (shot.frame.width, shot.frame.height))
    }
}

/// The player's capture consent, switched by the `consent on|off` lines (CHR-01, CHR-02): nothing is captured without it.
struct SwitchConsent(std::sync::Arc<AtomicBool>);

impl ConsentStore for SwitchConsent {
    fn load(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    fn save(&self, consent: bool) -> Result<(), StoreError> {
        self.0.store(consent, Ordering::SeqCst);
        Ok(())
    }
}

/// What a hook does once, after the keyboard typed some characters.
type AfterChars = (usize, std::sync::Arc<dyn Fn() + Send + Sync>);

/// The typer, the foreground window and the modifier keys of the headless agent (assisted typing, FR-28): plain state the
/// acceptance steps drive with lines. It records what was typed and nothing reaches an operating system.
#[derive(Default)]
struct HeadlessKeyboard {
    typed: Mutex<String>,
    typed_while_held: AtomicUsize,
    unfocused: AtomicBool,
    lose_focus_after: Mutex<Option<usize>>,
    held_until: Mutex<Option<std::time::Instant>>,
    held_forever: AtomicBool,
    after_chars: Mutex<Option<AfterChars>>,
}

impl HeadlessKeyboard {
    fn held(&self) -> bool {
        self.held_forever.load(Ordering::SeqCst)
            || self
                .held_until
                .lock()
                .map(|until| until.is_some_and(|until| std::time::Instant::now() < until))
                .unwrap_or(false)
    }

    /// What was typed and how many characters went out while the modifier keys were held, and forgets both.
    fn take(&self) -> (String, usize) {
        let text = self
            .typed
            .lock()
            .map(|mut typed| std::mem::take(&mut *typed))
            .unwrap_or_default();
        (text, self.typed_while_held.swap(0, Ordering::SeqCst))
    }
}

impl KeyTyper for HeadlessKeyboard {
    fn type_char(&self, character: TypableChar) {
        if self.held() {
            self.typed_while_held.fetch_add(1, Ordering::SeqCst);
        }
        let count = {
            let Ok(mut typed) = self.typed.lock() else {
                return;
            };
            typed.push(character.get());
            typed.len()
        };
        if self.lose_focus_after.lock().ok().and_then(|after| *after) == Some(count) {
            self.unfocused.store(true, Ordering::SeqCst);
        }
        let hook = self
            .after_chars
            .lock()
            .ok()
            .and_then(|mut hook| hook.take_if(|(after, _)| *after == count));
        if let Some((_, hook)) = hook {
            hook();
        }
    }
}

impl ForegroundWindow for HeadlessKeyboard {
    fn game_has_focus(&self) -> bool {
        !self.unfocused.load(Ordering::SeqCst)
    }
}

impl ModifierState for HeadlessKeyboard {
    fn any_held(&self, _modifiers: Modifiers) -> bool {
        self.held()
    }
}

/// The room the `assign` line makes the agent hold: the id is fixed, the name is the line's.
const ASSIGNED_ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

fn assignment_named(name: &str) -> Assignment {
    Assignment {
        room: RoomId::new(ASSIGNED_ROOM),
        run: std::num::NonZeroU64::MIN,
        expected_game_name: GameName::new(name),
        members: Vec::new(),
    }
}

/// Applies one assisted-typing line to the keyboard: `focus on|off|lose-after <n>`, `keys free|hold <ms>|hold-forever`.
fn apply_keyboard(keyboard: &HeadlessKeyboard, command: &KeyboardCommand) {
    match command {
        KeyboardCommand::Focus(on) => keyboard.unfocused.store(!on, Ordering::SeqCst),
        KeyboardCommand::LoseFocusAfter(count) => {
            if let Ok(mut after) = keyboard.lose_focus_after.lock() {
                *after = Some(*count);
            }
        }
        KeyboardCommand::KeysFree => {
            keyboard.held_forever.store(false, Ordering::SeqCst);
            if let Ok(mut until) = keyboard.held_until.lock() {
                *until = None;
            }
        }
        KeyboardCommand::KeysHoldFor(millis) => {
            if let Ok(mut until) = keyboard.held_until.lock() {
                *until = Some(std::time::Instant::now() + Duration::from_millis(*millis));
            }
        }
        KeyboardCommand::KeysHoldForever => keyboard.held_forever.store(true, Ordering::SeqCst),
    }
}

/// What the example reads: the F0 fixture (`read` lines, one sidecar text), or the shown frames the screen loop reads.
enum ScreenMode {
    Read(String),
    Screens {
        shared: SharedShot,
        consent: std::sync::Arc<AtomicBool>,
        script: std::sync::Arc<Script>,
    },
}

/// One line of the example's input (module docs). Any other line is `Other` and changes nothing.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Read,
    Show(PathBuf),
    Consent(bool),
    /// `capture print|graphics good|black|failed`: how a capture method answers from now on (capture-cascade).
    Capture(CaptureMethod, Behaviour),
    /// `minimize on|off`: the game window is minimized, or back.
    Minimize(bool),
    /// `assign <name>`: the agent holds a room with this game name (assisted typing, FR-28).
    Assign(String),
    /// `fill`: the player presses the fill hotkey.
    Fill,
    /// `fill-again-after <n>`: after `n` characters were typed, the fill hotkey is pressed once more.
    FillAgainAfter(usize),
    Keyboard(KeyboardCommand),
    Other,
}

/// A line that changes the headless keyboard (assisted typing, FR-28).
#[derive(Debug, PartialEq, Eq)]
pub enum KeyboardCommand {
    Focus(bool),
    LoseFocusAfter(usize),
    KeysFree,
    KeysHoldFor(u64),
    KeysHoldForever,
}

/// Reads one input line as a command.
pub fn parse_command(line: &str) -> Command {
    let line = line.trim();
    if line == "read" {
        return Command::Read;
    }
    if let Some(path) = line.strip_prefix("show ") {
        return Command::Show(PathBuf::from(path.trim()));
    }
    if let Some(rest) = line.strip_prefix("capture ") {
        let mut words = rest.split_whitespace();
        let method = match words.next() {
            Some("print") => CaptureMethod::PrintWindow,
            Some("graphics") => CaptureMethod::GraphicsCapture,
            _ => return Command::Other,
        };
        let behaviour = match words.next() {
            Some("good") => Behaviour::Good,
            Some("black") => Behaviour::Black,
            Some("failed") => Behaviour::Failed,
            _ => return Command::Other,
        };
        return Command::Capture(method, behaviour);
    }
    if let Some(name) = line.strip_prefix("assign ") {
        return Command::Assign(name.trim().to_string());
    }
    if let Some(count) = line.strip_prefix("fill-again-after ") {
        return count
            .trim()
            .parse()
            .map_or(Command::Other, Command::FillAgainAfter);
    }
    if let Some(count) = line.strip_prefix("focus lose-after ") {
        return count.trim().parse().map_or(Command::Other, |count| {
            Command::Keyboard(KeyboardCommand::LoseFocusAfter(count))
        });
    }
    if let Some(millis) = line.strip_prefix("keys hold ") {
        return millis.trim().parse().map_or(Command::Other, |millis| {
            Command::Keyboard(KeyboardCommand::KeysHoldFor(millis))
        });
    }
    match line {
        "minimize on" => Command::Minimize(true),
        "minimize off" => Command::Minimize(false),
        "consent on" => Command::Consent(true),
        "consent off" => Command::Consent(false),
        "fill" => Command::Fill,
        "focus on" => Command::Keyboard(KeyboardCommand::Focus(true)),
        "focus off" => Command::Keyboard(KeyboardCommand::Focus(false)),
        "keys free" => Command::Keyboard(KeyboardCommand::KeysFree),
        "keys hold-forever" => Command::Keyboard(KeyboardCommand::KeysHoldForever),
        _ => Command::Other,
    }
}

/// The agent's token and version for each relay request, read from the store (AD-101).
struct TokenHeaders {
    tokens: std::sync::Arc<dyn TokenStore + Send + Sync>,
    version: String,
}

impl HeaderSource for TokenHeaders {
    fn token(&self) -> Option<Secret> {
        self.tokens.load()
    }

    fn agent_version(&self) -> String {
        self.version.clone()
    }
}

struct Arguments {
    api_base: String,
    fixture: PathBuf,
    party: bool,
    /// The version the example declares in `X-Agent-Version`. The API refuses an agent below its minimum (426), so a
    /// stack with a minimum above the crate version needs the version to be declared (`--agent-version`).
    agent_version: String,
    /// The player has given capture consent before the run starts (`--consent`, CHR-01).
    consent: bool,
    /// Where the last good remote configuration is kept (`--config-dir`, remote-config RCF-06). Without it the example runs
    /// no configuration loop.
    config_dir: Option<PathBuf>,
    /// The interval between fetches of the configuration (`--config-every-ms`; six hours in the product).
    config_every: Duration,
}

fn parse_arguments(args: &[String]) -> Result<Arguments, String> {
    let mut api_base = None;
    let mut fixture = None;
    let mut party = false;
    let mut agent_version = None;
    let mut consent = false;
    let mut config_dir = None;
    let mut config_every = CHECK_EVERY;
    let mut rest = args.iter();
    while let Some(flag) = rest.next() {
        if flag == "--consent" {
            consent = true;
            continue;
        }
        let value = rest.next().ok_or_else(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--api-base" => api_base = Some(value.clone()),
            "--agent-version" => agent_version = Some(value.clone()),
            "--config-dir" => config_dir = Some(PathBuf::from(value)),
            "--config-every-ms" => {
                let millis: u64 = value
                    .parse()
                    .map_err(|_| format!("--config-every-ms needs a whole number, not {value}"))?;
                config_every = Duration::from_millis(millis);
            }
            "--read-fixture" => fixture = Some(PathBuf::from(value)),
            "--party-fixture" => {
                fixture = Some(PathBuf::from(value));
                party = true;
            }
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(Arguments {
        api_base: api_base.ok_or("--api-base is required")?,
        fixture: fixture.ok_or("--read-fixture or --party-fixture is required")?,
        party,
        agent_version: agent_version.unwrap_or_else(|| VERSION.to_string()),
        consent,
        config_dir,
        config_every,
    })
}

/// The Party fixture's sidecar: `<png>.json`, next to the image.
fn party_sidecar_path(fixture: &Path) -> PathBuf {
    let mut name = fixture.as_os_str().to_os_string();
    name.push(".json");
    PathBuf::from(name)
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
    mode: ScreenMode,
    version: &str,
    events: UnboundedSender<Value>,
    keyboard: &std::sync::Arc<HeadlessKeyboard>,
    remote_config: Option<(PathBuf, Duration)>,
) -> Result<(Handle<Reporting>, Probe, TelemetryGuard), String> {
    let base = api_base.url().as_str().trim_end_matches('/').to_string();
    // The F0 read path reads the sidecar text. The screen mode captures the shown frames with the player's consent and reads
    // their regions from the sidecars, so the screen loop (the Party panel, the character screens) runs as it does for the
    // game window.
    type TextPort = std::sync::Arc<dyn TextReader + Send + Sync>;
    type FramePort = std::sync::Arc<dyn FrameSource + Send + Sync>;
    type ConsentPort = std::sync::Arc<dyn ConsentStore + Send + Sync>;
    let (text, frames, consent, panel): (TextPort, FramePort, ConsentPort, TextPort) = match mode {
        ScreenMode::Read(sidecar) => (
            std::sync::Arc::new(Sidecar(sidecar)),
            std::sync::Arc::new(NoFrames),
            std::sync::Arc::new(NoConsent),
            std::sync::Arc::new(Sidecar(String::new())),
        ),
        ScreenMode::Screens {
            shared,
            consent,
            script,
        } => (
            std::sync::Arc::new(ShownText(std::sync::Arc::clone(&shared))),
            // The screen loop captures through the cascade, over the scripted methods (capture-cascade).
            std::sync::Arc::new(Capturer::new(ScriptedMethods {
                shared: std::sync::Arc::clone(&shared),
                script,
            })),
            std::sync::Arc::new(SwitchConsent(consent)),
            std::sync::Arc::new(ShownText(shared)),
        ),
    };
    let screen_reader: std::sync::Arc<dyn d2rmm_agent_core::ports::FrameReader + Send + Sync> =
        std::sync::Arc::new(ScreenReader::new(
            std::sync::Arc::clone(&panel),
            std::sync::Arc::new(LanguagePack::english()),
        ));
    let tokens: std::sync::Arc<dyn TokenStore + Send + Sync> =
        std::sync::Arc::new(MemoryTokens::default());
    let export = ExportConfig {
        endpoint: format!("{base}/v1/telemetry/traces"),
        headers: std::sync::Arc::new(TokenHeaders {
            tokens: std::sync::Arc::clone(&tokens),
            version: version.to_string(),
        }),
        ratio: EXPORT_RATIO,
        agent_version: version.to_string(),
        environment: "headless".to_string(),
    };
    let guard = telemetry::init(Mode::Release, Some(export)).map_err(|error| error.to_string())?;

    let http = client(api_base).map_err(|error| error.to_string())?;
    let gateway = std::sync::Arc::new(Reporting {
        inner: HttpGateway::new(ApiClient::new(version, api_base, http)),
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
            reader: text,
            ids: std::sync::Arc::new(SequentialIds::new()),
            clock,
            gateway: std::sync::Arc::clone(&gateway),
            tokens: std::sync::Arc::clone(&tokens),
        },
        screen: d2rmm_agent_core::watch_screen::ScreenPorts {
            party: d2rmm_agent_core::party::PartyPorts {
                read: ReadPorts {
                    reader: panel,
                    ids: std::sync::Arc::new(SequentialIds::new()),
                    clock: std::sync::Arc::new(WallTime),
                    gateway: std::sync::Arc::clone(&gateway),
                    tokens: std::sync::Arc::clone(&tokens),
                },
                language: std::sync::Arc::new(d2rmm_agent_domain::language::LanguagePack::english()),
            },
            gateway,
            tokens: std::sync::Arc::clone(&tokens),
            processes: std::sync::Arc::new(GameOpen),
            frames,
            reader: screen_reader,
            consent,
        },
    };
    let config = Config {
        version: version.to_string(),
    };
    let sink: std::sync::Arc<dyn StateSink + Send + Sync> = std::sync::Arc::new(Lines {
        events,
        last: Mutex::new(None),
    });
    let (handle, probe) = Runtime::start_with_probe(&config, sink, groups);
    let handle = handle.with_typing(FillPorts {
        typer: keyboard.clone(),
        focus: keyboard.clone(),
        keys: keyboard.clone(),
    });
    // The remote configuration loop (remote-config RCF-04): the agent's own API, the token it holds and the last good body in
    // the directory the scenario names. Without a directory the example runs no loop.
    let handle = match remote_config {
        None => handle,
        Some((directory, every)) => {
            let http = client(api_base).map_err(|error| error.to_string())?;
            handle.with_config(
                ConfigPorts {
                    gateway: std::sync::Arc::new(HttpGateway::new(ApiClient::new(
                        version, api_base, http,
                    ))),
                    tokens: std::sync::Arc::clone(&tokens),
                    store: std::sync::Arc::new(FileConfigStore::in_directory(Some(directory))),
                    reader: std::sync::Arc::new(WireReader),
                },
                every,
            )
        }
    };
    Ok((handle, probe, guard))
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
    let shared: SharedShot = std::sync::Arc::new(Mutex::new(None));
    let consent = std::sync::Arc::new(AtomicBool::new(arguments.consent));
    let script = std::sync::Arc::new(Script::default());
    let mode = if arguments.party {
        // The first frame is the fixture picture, shown from the start; `show <png>` replaces it.
        *shared
            .lock()
            .map_err(|_| failure(1, "the shown frame is poisoned"))? = Some(Shot {
            frame: frame.clone(),
            sidecar: party_sidecar_path(&arguments.fixture),
        });
        ScreenMode::Screens {
            shared: std::sync::Arc::clone(&shared),
            consent: std::sync::Arc::clone(&consent),
            script: std::sync::Arc::clone(&script),
        }
    } else {
        let sidecar = std::fs::read_to_string(sidecar_path(&arguments.fixture))
            .map_err(|error| failure(1, format!("cannot read the sidecar text: {error}")))?
            .trim()
            .to_string();
        ScreenMode::Read(sidecar)
    };

    let (events, received) = mpsc::unbounded_channel();
    let writer = tokio::spawn(write_lines(output, received));
    let keyboard = std::sync::Arc::new(HeadlessKeyboard::default());
    let fill_events = events.clone();
    let (handle, probe, guard) = start(
        &api_base,
        mode,
        &arguments.agent_version,
        events,
        &keyboard,
        arguments
            .config_dir
            .clone()
            .map(|directory| (directory, arguments.config_every)),
    )
    .map_err(|message| failure(1, message))?;
    let handle = std::sync::Arc::new(handle);
    if arguments.config_dir.is_some() {
        report_configuration(&handle, &fill_events);
    }

    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| failure(1, error.to_string()))?
    {
        match parse_command(&line) {
            Command::Read => handle.read_once(frame.clone()),
            Command::Show(path) => match decode_png(&path) {
                Ok(shown) => {
                    if let Ok(mut slot) = shared.lock() {
                        *slot = Some(Shot {
                            frame: shown,
                            sidecar: party_sidecar_path(&path),
                        });
                    }
                }
                Err(message) => eprintln!("{message}"),
            },
            Command::Consent(given) => consent.store(given, Ordering::SeqCst),
            Command::Capture(method, behaviour) => script.set(method, behaviour),
            Command::Minimize(minimized) => script.minimized.store(minimized, Ordering::SeqCst),
            Command::Assign(name) => probe.set_assignment(Some(assignment_named(&name))),
            Command::Fill => press_fill(&handle, &keyboard, &fill_events),
            Command::FillAgainAfter(count) => {
                let (again, keyboard_again, events_again) = (
                    std::sync::Arc::clone(&handle),
                    std::sync::Arc::clone(&keyboard),
                    fill_events.clone(),
                );
                if let Ok(mut hook) = keyboard.after_chars.lock() {
                    *hook = Some((
                        count,
                        std::sync::Arc::new(move || {
                            press_fill(&again, &keyboard_again, &events_again);
                        }),
                    ));
                }
            }
            Command::Keyboard(command) => apply_keyboard(&keyboard, &command),
            Command::Other => {}
        }
        // The agent's accept hotkey (RDY-07): the same accept path the Tauri global shortcut takes.
        if line.trim() == "hotkey" {
            handle.accept_ready_check();
        }
    }
    let _ = guard.shutdown();
    writer.abort();
    Ok(())
}

/// One line per fetch of the remote configuration: `{"event":"config","version":<n>,"outcome":"…","probeEvery":<n>,
/// "phrases":"built-in|configured"}`. A last good body applied at start prints its line at once, with no fetch behind it, so a
/// restart with the API gone still says which version runs (RCF-06, RCF-08).
fn report_configuration(
    handle: &std::sync::Arc<Handle<Reporting>>,
    events: &UnboundedSender<Value>,
) {
    let held = handle.config();
    if held.version > 0 {
        let _ = events.send(config_line(&held, Outcome::Applied));
    }
    let (handle, events) = (std::sync::Arc::clone(handle), events.clone());
    tokio::spawn(async move {
        let mut fetches = handle.config_fetches();
        while fetches.changed().await.is_ok() {
            let outcome = fetches.borrow_and_update().outcome;
            let _ = events.send(config_line(&handle.config(), outcome));
        }
    });
}

fn config_line(effective: &Effective, outcome: Outcome) -> Value {
    json!({
        "event": "config",
        "version": effective.version,
        "outcome": outcome.word(),
        "probeEvery": effective.cadence.probe_every,
        "phrases": if effective.phrases.is_configured() { "configured" } else { "built-in" },
    })
}

/// One press of the fill hotkey: prints `fill` with the outcome, what was typed and how much of it went out while the
/// hotkey's keys were held, or `fill-ignored` when the press only stopped a running fill or came too soon (AST-07).
fn press_fill(
    handle: &std::sync::Arc<Handle<Reporting>>,
    keyboard: &std::sync::Arc<HeadlessKeyboard>,
    events: &UnboundedSender<Value>,
) {
    let Some(task) = handle.fill_name() else {
        return;
    };
    let (keyboard, events) = (std::sync::Arc::clone(keyboard), events.clone());
    tokio::spawn(async move {
        let line = match task.await {
            Ok(Some(outcome)) => {
                let (text, while_held) = keyboard.take();
                json!({ "event": "fill", "outcome": outcome.as_str(), "text": text, "typedWhileHeld": while_held })
            }
            _ => json!({ "event": "fill-ignored" }),
        };
        let _ = events.send(line);
    });
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
    use crate::Behaviour;
    use d2rmm_agent_domain::capture_cascade::CaptureMethod;
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

    /// The API answers 426 to an agent below its minimum version, and then the agent shows no code. The example therefore
    /// declares the version it is given, and the stack's minimum decides whether that version is enough.
    #[test]
    fn the_declared_agent_version_is_the_default_and_can_be_set() {
        use super::{VERSION, parse_arguments};

        let base = [
            "--api-base",
            "http://127.0.0.1:1",
            "--read-fixture",
            "frame.png",
        ]
        .map(str::to_string);
        let default = parse_arguments(&base).expect("the arguments parse");
        assert_eq!(
            default.agent_version, VERSION,
            "without the flag, the crate version"
        );

        let mut declared = base.to_vec();
        declared.extend(["--agent-version".to_string(), "0.1.0".to_string()]);
        let declared = parse_arguments(&declared).expect("the arguments parse");
        assert_eq!(declared.agent_version, "0.1.0", "the flag's version");
    }

    #[test]
    fn the_token_headers_send_the_declared_version_on_every_relay_request() {
        use super::TokenHeaders;
        use d2rmm_agent_adapters::telemetry::relay_client::HeaderSource;

        let headers = TokenHeaders {
            tokens: Arc::new(d2rmm_agent_core::fakes::MemoryTokens::default()),
            version: "0.1.0".to_string(),
        };
        assert_eq!(headers.agent_version(), "0.1.0");
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

    /// The input lines of the example: `read`, `show <png>`, `consent on|off`; any other line changes nothing.
    #[test]
    fn the_input_lines_are_commands() {
        use super::{Command, KeyboardCommand, parse_command};
        use std::path::PathBuf;

        assert_eq!(parse_command("read"), Command::Read);
        assert_eq!(
            parse_command("show /tmp/select-titles.png"),
            Command::Show(PathBuf::from("/tmp/select-titles.png"))
        );
        assert_eq!(parse_command("consent on"), Command::Consent(true));
        assert_eq!(parse_command("consent off"), Command::Consent(false));
        assert_eq!(parse_command("consent maybe"), Command::Other);
        assert_eq!(
            parse_command("capture print black"),
            Command::Capture(CaptureMethod::PrintWindow, Behaviour::Black)
        );
        assert_eq!(
            parse_command("capture graphics failed"),
            Command::Capture(CaptureMethod::GraphicsCapture, Behaviour::Failed)
        );
        assert_eq!(parse_command("capture crop good"), Command::Other);
        assert_eq!(parse_command("capture print"), Command::Other);
        assert_eq!(parse_command("minimize on"), Command::Minimize(true));
        assert_eq!(parse_command("minimize off"), Command::Minimize(false));
        assert_eq!(
            parse_command("assign mmbaalh-12"),
            Command::Assign("mmbaalh-12".to_string())
        );
        assert_eq!(parse_command("fill"), Command::Fill);
        assert_eq!(
            parse_command("fill-again-after 3"),
            Command::FillAgainAfter(3)
        );
        assert_eq!(parse_command("fill-again-after x"), Command::Other);
        assert_eq!(
            parse_command("focus off"),
            Command::Keyboard(KeyboardCommand::Focus(false))
        );
        assert_eq!(
            parse_command("focus lose-after 3"),
            Command::Keyboard(KeyboardCommand::LoseFocusAfter(3))
        );
        assert_eq!(
            parse_command("keys hold 300"),
            Command::Keyboard(KeyboardCommand::KeysHoldFor(300))
        );
        assert_eq!(
            parse_command("keys hold-forever"),
            Command::Keyboard(KeyboardCommand::KeysHoldForever)
        );
        assert_eq!(
            parse_command("keys free"),
            Command::Keyboard(KeyboardCommand::KeysFree)
        );
        assert_eq!(parse_command(""), Command::Other);
    }

    /// The sidecar key of a region is the key of the Party panel or of the character screen that owns it (AGN-02, CHR-06).
    #[test]
    fn a_region_names_its_sidecar_key() {
        use super::region_key;
        use d2rmm_agent_core::ports::Rgba;
        use d2rmm_agent_domain::layout::{PanelRegion, ScreenRegion, panel_region, screen_region};

        let frame = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let field = panel_region(PanelRegion::GameNameField, 1920, 1080).expect("the panel");
        assert_eq!(region_key(&frame, field).as_deref(), Some("gameNameField"));
        let name = screen_region(ScreenRegion::CardName(3), 1920, 1080).expect("the card");
        assert_eq!(region_key(&frame, name).as_deref(), Some("cardName3"));
        let unknown = d2rmm_agent_domain::vision::Region {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        };
        assert_eq!(
            region_key(&frame, unknown),
            None,
            "no region of the screens"
        );
    }

    /// A sidecar's `lines` are shown at their own boxes, whatever the layout's fixed regions are (screen-recognition).
    #[test]
    fn a_sidecar_shows_its_boxed_lines() {
        use super::sidecar_lines;
        use d2rmm_agent_core::ports::Rgba;

        let directory = std::env::temp_dir().join(format!("d2rmm-lines-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("a directory");
        let sidecar = directory.join("shot.png.json");
        std::fs::write(
            &sidecar,
            r#"{ "createNew": "Create New", "lines": [
                { "text": "Life: 9 / 9", "x": 436, "y": 880, "width": 170, "height": 22 },
                { "text": "no box" } ] }"#,
        )
        .expect("a sidecar");
        let frame = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let lines = sidecar_lines(&sidecar, &frame);
        std::fs::remove_dir_all(&directory).ok();
        assert_eq!(lines.len(), 1, "a line with no box is not shown");
        assert_eq!(lines[0].text, "Life: 9 / 9");
        assert_eq!((lines[0].region.x, lines[0].region.y), (436, 880));
    }

    /// `--consent` gives the player's consent before the run; without it the example reads nothing.
    #[test]
    fn consent_is_a_flag_that_takes_no_value() {
        use super::parse_arguments;

        let base = [
            "--api-base",
            "http://127.0.0.1:1",
            "--party-fixture",
            "frame.png",
        ]
        .map(str::to_string);
        assert!(
            !parse_arguments(&base).expect("parses").consent,
            "no flag, no consent"
        );
        let mut given = base.to_vec();
        given.push("--consent".to_string());
        assert!(
            parse_arguments(&given).expect("parses").consent,
            "the flag gives consent"
        );
    }

    #[test]
    fn the_configuration_flags_name_a_directory_and_an_interval() {
        use super::{CHECK_EVERY, parse_arguments};

        let base = [
            "--api-base",
            "http://127.0.0.1:1",
            "--party-fixture",
            "frame.png",
        ]
        .map(str::to_string);
        let none = parse_arguments(&base).expect("parses");
        assert_eq!(none.config_dir, None, "no directory, no loop");
        assert_eq!(none.config_every, CHECK_EVERY, "six hours by default");

        let mut given = base.to_vec();
        given.extend(
            ["--config-dir", "/tmp/config", "--config-every-ms", "500"].map(str::to_string),
        );
        let given = parse_arguments(&given).expect("parses");
        assert_eq!(
            given.config_dir,
            Some(std::path::PathBuf::from("/tmp/config"))
        );
        assert_eq!(given.config_every, Duration::from_millis(500));

        let mut broken = base.to_vec();
        broken.extend(["--config-every-ms", "soon"].map(str::to_string));
        assert!(parse_arguments(&broken).is_err());
    }

    #[test]
    fn the_config_line_says_the_version_the_outcome_the_cadence_and_the_phrases() {
        use super::config_line;
        use d2rmm_agent_core::remote_config::Outcome;
        use d2rmm_agent_domain::remote_config::{Effective, Words};

        let mut effective = Effective::built_in();
        assert_eq!(
            config_line(&effective, Outcome::Unchanged),
            serde_json::json!({
                "event": "config", "version": 0, "outcome": "unchanged", "probeEvery": 60, "phrases": "built-in",
            })
        );
        effective.version = 5;
        effective.cadence.probe_every = 30;
        effective.phrases.en = Words {
            party: Some("Party".into()),
            ..Words::default()
        };
        assert_eq!(
            config_line(&effective, Outcome::Applied),
            serde_json::json!({
                "event": "config", "version": 5, "outcome": "applied", "probeEvery": 30, "phrases": "configured",
            })
        );
    }
}
