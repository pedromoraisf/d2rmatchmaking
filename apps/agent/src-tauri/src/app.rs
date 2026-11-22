//! The app wiring (design.md § Runtime, state and telemetry, § App shell; AGS-05, AGS-34, AD-073). `run` starts telemetry,
//! reads the build configuration, starts the core runtime and sends every `AgentView` to the window as `agent-state`. The
//! "Get a new code" command reaches the runtime through `CodeRequester`, so a fake can stand in for the handle in a test.
//! The Tauri shell exists on Windows only; this module is compiled where something uses it (Windows and tests), so no
//! item is left dead on another target.
#![cfg(any(windows, test))]

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_core::ports::{ConsentStore, StoreError};
use d2rmm_agent_core::runtime::Handle;
use d2rmm_agent_core::view::{AgentView, HotkeyFailure, HotkeyPress, HotkeySlot};
use d2rmm_agent_domain::typing::{HotkeyAction, HotkeyChoice, HotkeyKey, HotkeyPair};
use tauri::Url;

use crate::adapters::consent_store::FileConsentStore;
use crate::adapters::hotkey_store::FileHotkeyStore;

/// What the command handler needs from the runtime: a request for one new pairing code.
pub trait CodeRequester {
    fn request_new_code(&self);
}

impl CodeRequester for Handle<HttpGateway> {
    fn request_new_code(&self) {
        self.get_new_code();
    }
}

/// Registers and unregisters the ready-check hotkey with the OS. The app's implementation lives on the main thread, where
/// the OS wants it (RDY-07).
pub trait HotkeyRegistrar {
    /// Registers (`on`) or unregisters the hotkey. Returns whether the OS accepted it.
    fn set(&self, on: bool) -> bool;

    /// Why the last refused call was refused, as a closed code. Asked only after `set` returned `false`.
    fn failure(&self) -> HotkeyFailure {
        HotkeyFailure::Refused
    }
}

/// Brings the registration in line with whether a ready check is open (RDY-07). `registered` is what the OS holds now. A
/// refused call (another program holds the keys) leaves it unchanged, so the next change tries again.
pub fn sync_hotkey(registered: &AtomicBool, open: bool, registrar: &dyn HotkeyRegistrar) {
    if registered.load(Ordering::SeqCst) == open {
        return;
    }
    if registrar.set(open) {
        registered.store(open, Ordering::SeqCst);
    }
}

/// One hotkey the app registers with the OS, and which combination it holds now. A key the player changed while it was
/// registered is unregistered first, so the OS never holds the old combination (AST-01).
pub struct Slot {
    registered: AtomicBool,
    held: Mutex<Option<HotkeyChoice>>,
}

impl Slot {
    pub fn new() -> Self {
        Self {
            registered: AtomicBool::new(false),
            held: Mutex::new(None),
        }
    }

    /// The combination the OS holds for this slot now.
    pub fn held(&self) -> Option<HotkeyChoice> {
        *self
            .held
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn set_held(&self, choice: Option<HotkeyChoice>) {
        *self
            .held
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = choice;
    }
}

impl Default for Slot {
    fn default() -> Self {
        Self::new()
    }
}

/// Brings one slot in line with the combination wanted now: `None` when the hotkey must not be registered (no ready check
/// is open, no room is held). `registrar_for` gives the registrar of one combination. Each OS call is made once, only on a
/// change; a refused call leaves the slot as it was, so the next change tries again (RDY-07, AST-01). Returns why the slot
/// wants a combination the OS does not hold, or `None` when it holds it or nothing is wanted: the window must say so (AST-08).
pub fn reconcile_slot(
    slot: &Slot,
    wanted: Option<HotkeyChoice>,
    registrar_for: &dyn Fn(HotkeyChoice) -> Box<dyn HotkeyRegistrar>,
) -> Option<HotkeyFailure> {
    let mut failure = None;
    if let Some(held) = slot.held().filter(|held| Some(*held) != wanted) {
        let registrar = registrar_for(held);
        sync_hotkey(&slot.registered, false, registrar.as_ref());
        if slot.registered.load(Ordering::SeqCst) {
            failure = Some(registrar.failure());
        } else {
            slot.set_held(None);
        }
    }
    if let (Some(wanted), None) = (wanted, slot.held()) {
        let registrar = registrar_for(wanted);
        sync_hotkey(&slot.registered, true, registrar.as_ref());
        if slot.registered.load(Ordering::SeqCst) {
            slot.set_held(Some(wanted));
        } else {
            failure = Some(registrar.failure());
        }
    }
    (wanted.is_some() && slot.held() != wanted).then(|| failure.unwrap_or(HotkeyFailure::Refused))
}

/// Reconciles one slot and tells `report` why the OS refused the combination wanted now, or `None` once it is held or no
/// longer wanted (AST-01, AST-08). `report` is idempotent: it is called after every reconciliation.
pub fn reconcile_and_report(
    kind: HotkeySlot,
    slot: &Slot,
    wanted: Option<HotkeyChoice>,
    registrar_for: &dyn Fn(HotkeyChoice) -> Box<dyn HotkeyRegistrar>,
    report: &dyn Fn(HotkeySlot, Option<HotkeyFailure>),
) {
    report(kind, reconcile_slot(slot, wanted, registrar_for));
}

/// The main thread could not be asked to register: every combination wanted now is unavailable (AST-01, AST-08).
pub fn report_dispatch_failed(
    wanted: (Option<HotkeyChoice>, Option<HotkeyChoice>),
    report: &dyn Fn(HotkeySlot, Option<HotkeyFailure>),
) {
    if wanted.0.is_some() {
        report(HotkeySlot::Accept, Some(HotkeyFailure::Dispatch));
    }
    if wanted.1.is_some() {
        report(HotkeySlot::Fill, Some(HotkeyFailure::Dispatch));
    }
}

/// The two combinations the OS should hold for this view: the accept key exactly while a ready check is open (RDY-07) and
/// the fill key exactly while a room is held (AST-01). A combination the window shows that does not read is never wanted.
pub fn wanted_hotkeys(view: &AgentView) -> (Option<HotkeyChoice>, Option<HotkeyChoice>) {
    let read = |text: &str| HotkeyChoice::parse(text).ok();
    (
        view.ready_check_open
            .then(|| read(&view.hotkeys.accept))
            .flatten(),
        view.room
            .is_some()
            .then(|| read(&view.hotkeys.fill))
            .flatten(),
    )
}

/// Tells which combination a press belongs to. `id_of` gives the OS id of one combination, `None` when it does not map to
/// a key (field test of 2026-11-21: a press that reached the app and matched nothing left no trace).
pub fn press_of(
    pair: &HotkeyPair,
    id_of: &dyn Fn(HotkeyChoice) -> Option<u32>,
    id: u32,
) -> HotkeyPress {
    if id_of(pair.accept()) == Some(id) {
        HotkeyPress::Accept
    } else if id_of(pair.fill()) == Some(id) {
        HotkeyPress::Fill
    } else {
        HotkeyPress::Unmatched
    }
}

/// The name of the key in the OS hotkey crate's code list (`KeyA`, `Digit7`, `F12`).
pub fn code_name(key: HotkeyKey) -> String {
    match key {
        HotkeyKey::Letter(letter) => format!("Key{letter}"),
        HotkeyKey::Digit(digit) => format!("Digit{digit}"),
        HotkeyKey::Function(number) => format!("F{number}"),
    }
}

/// The "Get a new code" command: one request to the runtime. The runtime honours it only while the code is paused (AGS-34).
pub fn handle_get_new_code(requester: &impl CodeRequester) {
    requester.request_new_code();
}

/// The file that holds the consent, in the app's configuration directory (CHR-02).
pub const SETTINGS_FILE: &str = "settings.json";

/// The consent store over the settings file of `directory`. With no directory the store never consents (CHR-01).
pub fn consent_store_in(directory: Option<PathBuf>) -> FileConsentStore {
    FileConsentStore::new(directory.map(|directory| directory.join(SETTINGS_FILE)))
}

/// Whether the player consented to capture (CHR-01). The screen loop reads the same store before every frame.
pub fn handle_get_consent(store: &dyn ConsentStore) -> bool {
    store.load()
}

/// The player's "Allow" or "Withdraw" (CHR-02): stored at once, so the next frame already follows it.
pub fn handle_set_consent(store: &dyn ConsentStore, consent: bool) -> Result<bool, StoreError> {
    store.save(consent)?;
    Ok(consent)
}

/// The player's choice of one hotkey (AST-01): the new pair, stored on this PC, or the refusal code the window maps to a
/// message (`no-modifier`, `needs-ctrl-or-alt`, `reserved`, `confirming-key`, `unsupported-key`, `same-as-other`, or `not-saved`). Nothing changes on a refusal.
pub fn apply_hotkey_change(
    current: &HotkeyPair,
    action: &str,
    combination: &str,
    store: &FileHotkeyStore,
) -> Result<HotkeyPair, &'static str> {
    let action = HotkeyAction::parse(action).ok_or("unsupported-key")?;
    let choice = HotkeyChoice::parse(combination).map_err(|refusal| refusal.code())?;
    let next = match action {
        HotkeyAction::Accept => current.with_accept(choice),
        HotkeyAction::Fill => current.with_fill(choice),
    }
    .map_err(|refusal| refusal.code())?;
    store.save(&next).map_err(|_| "not-saved")?;
    Ok(next)
}

/// The window may navigate only to the bundled app (AGS-04): the custom protocol of each platform.
pub fn is_app_url(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    )
}

/// The generated Tauri context. `generate_context!` is expanded once: a second expansion in the same test binary
/// defines the embedded Info.plist symbol twice on macOS.
pub fn app_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(windows)]
pub use shell::run;

#[cfg(windows)]
mod shell {
    use std::sync::Arc;

    use std::cell::RefCell;

    use global_hotkey::hotkey::{Code, HotKey, Modifiers};
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};

    use d2rmm_agent_adapters::config::ApiBase;
    use d2rmm_agent_adapters::config_store::FileConfigStore;
    use d2rmm_agent_adapters::http::api_client::ApiClient;
    use d2rmm_agent_adapters::http::gateway::HttpGateway;
    use d2rmm_agent_adapters::remote_config::WireReader;
    use d2rmm_agent_adapters::telemetry::relay_client::HeaderSource;
    use d2rmm_agent_adapters::telemetry::{
        self, ExportConfig, Mode, TelemetryTier, ratio_of, tier_of,
    };
    use d2rmm_agent_core::fill_name::FillPorts;
    use d2rmm_agent_core::groups::Groups;
    use d2rmm_agent_core::ports::{StateSink, TokenStore};
    use d2rmm_agent_core::remote_config::{CHECK_EVERY, ConfigPorts};
    use d2rmm_agent_core::runtime::{Handle, Runtime};
    use d2rmm_agent_core::secret::Secret;
    use d2rmm_agent_core::view::{AgentView, HotkeyFailure, HotkeyPress, HotkeySlot};

    use d2rmm_agent_domain::typing::HotkeyChoice;

    use super::{
        FileConsentStore, FileHotkeyStore, HotkeyRegistrar, Slot, app_context, apply_hotkey_change,
        code_name, consent_store_in, handle_get_consent, handle_get_new_code, handle_set_consent,
        is_app_url, press_of, reconcile_and_report, report_dispatch_failed, wanted_hotkeys,
    };
    use crate::adapters::token_store::KeyringTokenStore;
    use crate::adapters::typing::{HeldModifiers, SendTyper};
    use crate::adapters::window_capture::ForegroundGame;
    use crate::config;
    use crate::fixture_read;
    use d2rmm_agent_adapters::http;

    /// The OS hotkey of a combination the player chose (RDY-07, AST-01), or `None` when it does not map to a key.
    fn os_hotkey(choice: HotkeyChoice) -> Option<HotKey> {
        let mut modifiers = Modifiers::empty();
        modifiers.set(Modifiers::CONTROL, choice.modifiers.ctrl);
        modifiers.set(Modifiers::SHIFT, choice.modifiers.shift);
        modifiers.set(Modifiers::ALT, choice.modifiers.alt);
        let code = code_name(choice.key).parse::<Code>().ok()?;
        Some(HotKey::new(Some(modifiers), code))
    }

    thread_local! {
        /// The OS hotkey manager. On Windows it owns a hidden window and must live on the thread that runs the event loop,
        /// the Tauri main thread: it is created there, in `setup`, and used only there (`run_on_main_thread`).
        static MANAGER: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
    }

    /// The hotkeys of the app: every registration runs on the main thread, where the manager lives. The accept key is held
    /// exactly while a ready check is open (RDY-07) and the fill key exactly while a room is held (AST-01).
    struct MainThreadHotkey {
        app: AppHandle,
        accept: Arc<Slot>,
        fill: Arc<Slot>,
    }

    impl MainThreadHotkey {
        /// Registers and unregisters on the main thread, then records what the OS accepted.
        fn request(&self, view: &AgentView) {
            let (accept_wanted, fill_wanted) = wanted_hotkeys(view);
            let (accept, fill) = (self.accept.clone(), self.fill.clone());
            let app = self.app.clone();
            let queued = self.app.run_on_main_thread(move || {
                let report = reporter(&app);
                let local = |choice: HotkeyChoice| -> Box<dyn HotkeyRegistrar> {
                    Box::new(LocalManager(choice))
                };
                reconcile_and_report(
                    HotkeySlot::Accept,
                    &accept,
                    accept_wanted,
                    &local,
                    report.as_ref(),
                );
                reconcile_and_report(
                    HotkeySlot::Fill,
                    &fill,
                    fill_wanted,
                    &local,
                    report.as_ref(),
                );
            });
            if queued.is_err() {
                report_dispatch_failed((accept_wanted, fill_wanted), reporter(&self.app).as_ref());
            }
        }
    }

    /// Tells the runtime whether a hotkey is unavailable, for the window (AST-01, AST-08). Before the runtime is managed
    /// there is nobody to tell: the next view tries the registration again.
    fn reporter(app: &AppHandle) -> Box<dyn Fn(HotkeySlot, Option<HotkeyFailure>)> {
        let app = app.clone();
        Box::new(move |slot, reason| {
            if let Some(handle) = app.try_state::<Arc<Handle<HttpGateway>>>() {
                handle.set_hotkey_unavailable(slot, reason);
            }
        })
    }

    /// The manager of the main thread, as the registrar of one combination.
    struct LocalManager(HotkeyChoice);

    impl HotkeyRegistrar for LocalManager {
        fn set(&self, on: bool) -> bool {
            let Some(hotkey) = os_hotkey(self.0) else {
                return false;
            };
            MANAGER.with(|manager| match manager.borrow().as_ref() {
                Some(manager) if on => manager.register(hotkey).is_ok(),
                Some(manager) => manager.unregister(hotkey).is_ok(),
                None => false,
            })
        }

        fn failure(&self) -> HotkeyFailure {
            if os_hotkey(self.0).is_none() {
                HotkeyFailure::Unmapped
            } else if MANAGER.with(|manager| manager.borrow().is_none()) {
                HotkeyFailure::NoManager
            } else {
                HotkeyFailure::Refused
            }
        }
    }

    /// Creates the manager on the calling thread, which must be the main thread, and forwards each press to the runtime.
    fn start_hotkey(app: &AppHandle) {
        MANAGER.with(|manager| *manager.borrow_mut() = GlobalHotKeyManager::new().ok());
        let app = app.clone();
        std::thread::spawn(move || {
            while let Ok(event) = GlobalHotKeyEvent::receiver().recv() {
                on_hotkey(&app, &event);
            }
        });
    }

    /// The label of the one window declared in tauri.conf.json. It is created in `setup` so its navigation is restricted.
    const MAIN_WINDOW: &str = "main";
    /// The event that carries every `AgentView` to the window.
    const AGENT_STATE: &str = "agent-state";

    /// Asks the runtime for a new pairing code.
    #[tauri::command]
    fn get_new_code(handle: State<'_, Arc<Handle<HttpGateway>>>) {
        handle_get_new_code(&**handle);
    }

    /// The consent store of this app: the settings file in its configuration directory.
    fn consent_store(app: &AppHandle) -> FileConsentStore {
        consent_store_in(app.path().app_config_dir().ok())
    }

    /// Whether the player consented to capture (CHR-01).
    #[tauri::command]
    fn get_consent(app: AppHandle) -> bool {
        handle_get_consent(&consent_store(&app))
    }

    /// Stores the player's answer. A refusal is one fixed word, never the path or the cause (AGS-09).
    #[tauri::command]
    fn set_consent(app: AppHandle, consent: bool) -> Result<bool, String> {
        handle_set_consent(&consent_store(&app), consent)
            .map_err(|_| "consent-not-saved".to_string())
    }

    /// The hotkeys of this app: the file in its configuration directory, apart from the consent file.
    fn hotkey_store(app: &AppHandle) -> FileHotkeyStore {
        FileHotkeyStore::in_directory(app.path().app_config_dir().ok())
    }

    /// The player's choice of one hotkey (AST-01). A refusal is one fixed code, never a path or a cause (AGS-09).
    #[tauri::command]
    fn set_hotkey(
        app: AppHandle,
        handle: State<'_, Arc<Handle<HttpGateway>>>,
        action: String,
        combination: String,
    ) -> Result<(), String> {
        let next = apply_hotkey_change(
            &handle.hotkeys(),
            &action,
            &combination,
            &hotkey_store(&app),
        )
        .map_err(str::to_string)?;
        handle.set_hotkeys(next);
        Ok(())
    }

    /// Logs the location of a panic and never its payload, which can carry secrets (AGS-09).
    fn install_panic_hook() {
        std::panic::set_hook(Box::new(|info| match info.location() {
            Some(location) => {
                eprintln!("agent panicked at {}:{}", location.file(), location.line())
            }
            None => eprintln!("agent panicked"),
        }));
    }

    /// The state sink of the app: every view goes to the window, and to the fixture trigger in a fixture build.
    struct WindowSink {
        app: AppHandle,
        /// The hotkeys registered now: accept while a ready check is open (RDY-07), fill while a room is held (AST-01).
        hotkey: MainThreadHotkey,
        #[cfg(feature = "fixture-read")]
        fixture: Option<fixture_read::FixtureSink>,
    }

    impl WindowSink {
        #[cfg(feature = "fixture-read")]
        fn attach(&self, handle: Arc<Handle<HttpGateway>>) {
            if let Some(fixture) = &self.fixture {
                fixture.attach(handle);
            }
        }

        #[cfg(not(feature = "fixture-read"))]
        fn attach(&self, _handle: Arc<Handle<HttpGateway>>) {}

        #[cfg(feature = "fixture-read")]
        fn feed_fixture(&self, view: &AgentView) {
            if let Some(fixture) = &self.fixture {
                fixture.publish(view.clone());
            }
        }

        #[cfg(not(feature = "fixture-read"))]
        fn feed_fixture(&self, _view: &AgentView) {}
    }

    impl StateSink for WindowSink {
        fn publish(&self, view: AgentView) {
            self.feed_fixture(&view);
            self.hotkey.request(&view);
            let _ = self.app.emit(AGENT_STATE, view);
        }
    }

    /// A hotkey's press (RDY-02, RDY-07, AST-01). The accept combination accepts the held ready check; the fill combination
    /// types the held room's game name and stops (AST-07). Only a press does anything, and only of a combination the runtime
    /// holds now.
    fn on_hotkey(app: &AppHandle, event: &GlobalHotKeyEvent) {
        if event.state != HotKeyState::Pressed {
            return;
        }
        let Some(handle) = app.try_state::<Arc<Handle<HttpGateway>>>() else {
            return;
        };
        let id_of = |choice: HotkeyChoice| os_hotkey(choice).map(|hotkey| hotkey.id());
        let press = press_of(&handle.hotkeys(), &id_of, event.id);
        // Every press the OS delivers is shown in the window and, when it matches nothing, left as a span event.
        handle.record_hotkey_press(press);
        match press {
            HotkeyPress::Accept => handle.accept_ready_check(),
            HotkeyPress::Fill => {
                // The fill runs on the runtime's own task; the press only starts it.
                let handle = Arc::clone(&handle);
                tauri::async_runtime::spawn(async move {
                    let _ = handle.fill_name();
                });
            }
            HotkeyPress::Unmatched => {}
        }
    }

    /// The sampling ratio of the production tier: the default of the API and the site (OBS-43); the full tier samples all.
    const SAMPLER_RATIO: f64 = 0.1;

    /// The relay's token and version, read from the token store for each request, so the token is never captured (AD-101).
    struct TokenHeaders {
        tokens: Arc<dyn TokenStore + Send + Sync>,
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

    /// The export configuration of this build (ADR 037, which lifts AD-098): every release build exports, and the tier comes
    /// from the compile-time channel (`preview` and `staging` are full; `production`, none and unknown are production). A
    /// debug profile exports nothing.
    fn export_config(api_base: &ApiBase, version: &str) -> Option<ExportConfig> {
        if cfg!(debug_assertions) {
            return None;
        }
        let channel = crate::channel::build_channel();
        let tier = tier_of(channel);
        let base = api_base.url().as_str().trim_end_matches('/');
        Some(ExportConfig {
            endpoint: format!("{base}/v1/telemetry/traces"),
            headers: Arc::new(TokenHeaders {
                tokens: Arc::new(KeyringTokenStore::new()),
                version: version.to_string(),
            }),
            ratio: ratio_of(tier, SAMPLER_RATIO),
            agent_version: version.to_string(),
            environment: channel.unwrap_or("production").to_string(),
            tier,
        })
    }

    /// Starts the agent and the window. `build` supplies the port groups, given the app handle (for the updater) and the
    /// HTTP gateway the app built. A bad build configuration or a bad fixture path ends the process with exit code 1; a
    /// rejected flag exits 2.
    pub fn run(
        args: &[String],
        build: impl FnOnce(AppHandle, Arc<HttpGateway>) -> Groups<HttpGateway> + Send + 'static,
    ) {
        install_panic_hook();
        let fixture =
            fixture_read::parse_args(args).unwrap_or_else(|code| std::process::exit(code));
        let api_base = config::api_base(config::build_api_base(), !cfg!(debug_assertions))
            .unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1)
            });
        let mode = if cfg!(debug_assertions) {
            Mode::Debug
        } else {
            Mode::Release
        };
        let version = app_context().package_info().version.to_string();
        // The spans' detail follows the build channel in every profile; the names are recorded in the full tier only (OBT-06).
        d2rmm_agent_core::detail::set_full_tier(
            tier_of(crate::channel::build_channel()) == TelemetryTier::Full,
        );
        let export = export_config(&api_base, &version);
        let telemetry =
            telemetry::init(mode, export).expect("the telemetry subscriber is installed once");

        #[cfg(feature = "fixture-read")]
        let fixture = fixture.map(|path| {
            let frame = fixture_read::decode_png(&path).unwrap_or_else(|error| {
                eprintln!("{error}");
                std::process::exit(1)
            });
            fixture_read::FixtureSink::new(frame)
        });
        #[cfg(not(feature = "fixture-read"))]
        let _ = fixture;

        tauri::Builder::default()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(tauri::generate_handler![
                get_new_code,
                get_consent,
                set_consent,
                set_hotkey
            ])
            .setup(move |app| {
                let app_handle = app.handle().clone();
                let window_sink = Arc::new(WindowSink {
                    app: app_handle.clone(),
                    hotkey: MainThreadHotkey {
                        app: app_handle.clone(),
                        accept: Arc::new(Slot::new()),
                        fill: Arc::new(Slot::new()),
                    },
                    #[cfg(feature = "fixture-read")]
                    fixture,
                });
                start_hotkey(&app_handle);
                let sink: Arc<dyn StateSink + Send + Sync> = window_sink.clone();

                let version = app.package_info().version.to_string();
                let core_config = config::core_config(&version);
                let client = http::client::client(&api_base)?;
                let gateway = Arc::new(HttpGateway::new(ApiClient::new(
                    &version, &api_base, client,
                )));
                // The remote configuration (remote-config RCF-04, RCF-06): the agent's own API, the token it already holds and one
                // small file of the last good body in the app's configuration directory.
                let config_ports = ConfigPorts {
                    gateway: Arc::clone(&gateway),
                    tokens: Arc::new(KeyringTokenStore::new()),
                    store: Arc::new(FileConfigStore::in_directory(
                        app.path().app_config_dir().ok(),
                    )),
                    reader: Arc::new(WireReader),
                };
                let groups = build(app_handle, gateway);
                let handle = Arc::new(tauri::async_runtime::block_on(async move {
                    // The three ports of assisted typing (FR-28): the one place the agent can send input, and only as
                    // Unicode characters of a game name (ADR 010, AST-06).
                    Runtime::start(&core_config, sink, groups)
                        .with_typing(FillPorts {
                            typer: Arc::new(SendTyper),
                            focus: Arc::new(ForegroundGame),
                            keys: Arc::new(HeldModifiers),
                        })
                        .with_config(config_ports, CHECK_EVERY)
                }));
                if let Some(saved) = hotkey_store(app.handle()).load() {
                    handle.set_hotkeys(saved);
                }
                window_sink.attach(handle.clone());
                app.manage(handle);

                let window = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == MAIN_WINDOW)
                    .ok_or("tauri.conf.json declares no main window")?;
                WebviewWindowBuilder::from_config(&*app, window)?
                    .on_navigation(is_app_url)
                    .build()?;
                Ok(())
            })
            .run(app_context())
            .expect("error while running the agent");
        let _ = telemetry.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use tauri::Url;

    use d2rmm_agent_core::view::{HotkeyFailure, HotkeyPress, HotkeySlot};
    use d2rmm_agent_domain::typing::{HotkeyChoice, HotkeyPair};

    use super::{
        CodeRequester, FileHotkeyStore, Slot, app_context, apply_hotkey_change, code_name,
        consent_store_in, handle_get_consent, handle_get_new_code, handle_set_consent, is_app_url,
        press_of, reconcile_and_report, reconcile_slot, report_dispatch_failed, wanted_hotkeys,
    };
    use crate::config;

    /// A registrar that records its calls and accepts or refuses them.
    struct FakeRegistrar {
        accept: bool,
        calls: Cell<u32>,
    }

    impl super::HotkeyRegistrar for FakeRegistrar {
        fn set(&self, _on: bool) -> bool {
            self.calls.set(self.calls.get() + 1);
            self.accept
        }
    }

    #[test]
    fn the_hotkey_follows_the_open_check_and_calls_the_os_only_on_a_change() {
        let registered = super::AtomicBool::new(false);
        let registrar = FakeRegistrar {
            accept: true,
            calls: Cell::new(0),
        };
        super::sync_hotkey(&registered, false, &registrar);
        assert_eq!(registrar.calls.get(), 0);
        super::sync_hotkey(&registered, true, &registrar);
        super::sync_hotkey(&registered, true, &registrar);
        assert_eq!(registrar.calls.get(), 1);
        assert!(registered.load(super::Ordering::SeqCst));
        super::sync_hotkey(&registered, false, &registrar);
        assert_eq!(registrar.calls.get(), 2);
        assert!(!registered.load(super::Ordering::SeqCst));
    }

    #[test]
    fn a_refused_registration_stays_off_and_is_tried_again() {
        let registered = super::AtomicBool::new(false);
        let registrar = FakeRegistrar {
            accept: false,
            calls: Cell::new(0),
        };
        super::sync_hotkey(&registered, true, &registrar);
        super::sync_hotkey(&registered, true, &registrar);
        assert_eq!(registrar.calls.get(), 2);
        assert!(!registered.load(super::Ordering::SeqCst));
    }

    #[test]
    fn version_comes_from_package_json() {
        let context = app_context();
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package.json is JSON");
        assert_eq!(
            context.package_info().version.to_string(),
            package["version"]
                .as_str()
                .expect("package.json has a version"),
        );
    }

    #[test]
    fn runtime_config_carries_the_package_version() {
        let context = app_context();
        let version = context.package_info().version.to_string();
        let core_config = config::core_config(&version);
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("package.json is JSON");
        assert_eq!(
            core_config.version,
            package["version"]
                .as_str()
                .expect("package.json has a version"),
        );
    }

    #[test]
    fn navigation_stays_in_the_app() {
        assert!(is_app_url(
            &Url::parse("tauri://localhost/index.html").expect("url")
        ));
        assert!(is_app_url(
            &Url::parse("http://tauri.localhost/").expect("url")
        ));
        assert!(!is_app_url(
            &Url::parse("https://example.com/").expect("url")
        ));
    }

    /// A requester that counts the requests it receives.
    struct CountingRequester {
        requests: Cell<usize>,
    }

    impl CodeRequester for CountingRequester {
        fn request_new_code(&self) {
            self.requests.set(self.requests.get() + 1);
        }
    }

    #[test]
    fn get_new_code_reaches_the_runtime() {
        let requester = CountingRequester {
            requests: Cell::new(0),
        };
        handle_get_new_code(&requester);
        assert_eq!(requester.requests.get(), 1, "one command, one request");
    }

    #[test]
    fn the_consent_is_stored_and_read_back_through_the_settings_file() {
        let directory =
            std::env::temp_dir().join(format!("d2rmm-app-consent-{}", uuid::Uuid::new_v4()));
        let store = consent_store_in(Some(directory.clone()));

        assert!(!handle_get_consent(&store), "no answer yet is no consent");
        assert_eq!(handle_set_consent(&store, true), Ok(true));
        assert!(handle_get_consent(&store));
        assert_eq!(handle_set_consent(&store, false), Ok(false));
        assert!(!handle_get_consent(&store), "a withdrawal is read back");

        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn with_no_configuration_directory_consent_is_refused() {
        let store = consent_store_in(None);
        assert!(!handle_get_consent(&store));
        assert!(handle_set_consent(&store, true).is_err());
    }

    fn scratch_store() -> (FileHotkeyStore, std::path::PathBuf) {
        let directory = std::env::temp_dir().join(format!("d2rmm-hk-{}", uuid::Uuid::new_v4()));
        (
            FileHotkeyStore::in_directory(Some(directory.clone())),
            directory,
        )
    }

    #[test]
    fn a_valid_hotkey_choice_is_stored_and_returned() {
        let (store, directory) = scratch_store();
        let next = apply_hotkey_change(&HotkeyPair::defaults(), "fill", "alt+g", &store)
            .expect("a valid combination");
        assert_eq!(next.fill().to_string(), "Alt+G");
        assert_eq!(store.load(), Some(next));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn a_refused_hotkey_returns_its_code_and_stores_nothing() {
        let (store, directory) = scratch_store();
        let defaults = HotkeyPair::defaults();
        for (action, text, code) in [
            ("fill", "G", "no-modifier"),
            ("fill", "Shift+G", "needs-ctrl-or-alt"),
            ("fill", "Ctrl+C", "reserved"),
            ("accept", "Alt+F4", "reserved"),
            ("accept", "Win+Ctrl+Q", "reserved"),
            ("fill", "Ctrl+Shift+Enter", "confirming-key"),
            ("fill", "Ctrl+Home", "unsupported-key"),
            ("fill", "Ctrl+Shift+A", "same-as-other"),
            ("accept", "Ctrl+Shift+F", "same-as-other"),
            ("confirm", "Ctrl+Shift+Q", "unsupported-key"),
        ] {
            assert_eq!(
                apply_hotkey_change(&defaults, action, text, &store),
                Err(code),
                "{action} {text}"
            );
        }
        assert!(store.load().is_none(), "no refusal wrote the file");
        let nowhere = FileHotkeyStore::in_directory(None);
        assert_eq!(
            apply_hotkey_change(&defaults, "fill", "Alt+G", &nowhere),
            Err("not-saved")
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    /// A registrar factory that records every (combination, on) call and accepts or refuses them all.
    struct Recording {
        calls: std::rc::Rc<std::cell::RefCell<Vec<(String, bool)>>>,
        accept: bool,
        reason: HotkeyFailure,
    }

    struct Recorded {
        choice: HotkeyChoice,
        log: Recording,
    }

    impl super::HotkeyRegistrar for Recorded {
        fn set(&self, on: bool) -> bool {
            self.log
                .calls
                .borrow_mut()
                .push((self.choice.to_string(), on));
            self.log.accept
        }

        fn failure(&self) -> HotkeyFailure {
            self.log.reason
        }
    }

    fn reconcile(slot: &Slot, wanted: Option<&str>, log: &Recording) {
        let wanted = wanted.map(|text| HotkeyChoice::parse(text).expect("a valid combination"));
        reconcile_slot(slot, wanted, &|choice| {
            Box::new(Recorded {
                choice,
                log: Recording {
                    calls: log.calls.clone(),
                    accept: log.accept,
                    reason: log.reason,
                },
            })
        });
    }

    fn recording(accept: bool) -> Recording {
        Recording {
            calls: std::rc::Rc::default(),
            accept,
            reason: HotkeyFailure::Refused,
        }
    }

    /// A registrar that refuses everything and says why.
    fn failing(reason: HotkeyFailure) -> Recording {
        Recording {
            reason,
            ..recording(false)
        }
    }

    #[test]
    fn a_slot_registers_while_wanted_and_calls_the_os_only_on_a_change() {
        let (slot, log) = (Slot::new(), recording(true));
        reconcile(&slot, None, &log);
        reconcile(&slot, Some("Ctrl+Shift+F"), &log);
        reconcile(&slot, Some("Ctrl+Shift+F"), &log);
        reconcile(&slot, None, &log);
        reconcile(&slot, None, &log);
        assert_eq!(
            *log.calls.borrow(),
            [
                ("Ctrl+Shift+F".to_string(), true),
                ("Ctrl+Shift+F".to_string(), false)
            ]
        );
        assert!(slot.held().is_none());
    }

    #[test]
    fn a_changed_combination_unregisters_the_old_one_before_it_registers_the_new_one() {
        let (slot, log) = (Slot::new(), recording(true));
        reconcile(&slot, Some("Ctrl+Shift+F"), &log);
        reconcile(&slot, Some("Alt+G"), &log);
        assert_eq!(
            *log.calls.borrow(),
            [
                ("Ctrl+Shift+F".to_string(), true),
                ("Ctrl+Shift+F".to_string(), false),
                ("Alt+G".to_string(), true),
            ]
        );
        assert_eq!(
            slot.held().map(|held| held.to_string()),
            Some("Alt+G".to_string())
        );
    }

    #[test]
    fn a_refused_registration_leaves_the_slot_empty_and_the_next_change_tries_again() {
        let (slot, refusing) = (Slot::new(), recording(false));
        reconcile(&slot, Some("Ctrl+Shift+F"), &refusing);
        assert!(slot.held().is_none(), "the OS refused, so nothing is held");
        let accepting = recording(true);
        reconcile(&slot, Some("Ctrl+Shift+F"), &accepting);
        assert_eq!(accepting.calls.borrow().len(), 1, "tried again");
        assert!(slot.held().is_some());
    }

    #[test]
    fn a_refused_unregistration_keeps_the_old_combination_and_registers_nothing_new() {
        let (slot, accepting) = (Slot::new(), recording(true));
        reconcile(&slot, Some("Ctrl+Shift+F"), &accepting);
        let refusing = recording(false);
        reconcile(&slot, Some("Alt+G"), &refusing);
        assert_eq!(
            slot.held().map(|held| held.to_string()),
            Some("Ctrl+Shift+F".to_string())
        );
        assert_eq!(
            *refusing.calls.borrow(),
            [("Ctrl+Shift+F".to_string(), false)]
        );
    }

    #[test]
    fn the_view_wants_accept_only_during_a_ready_check_and_fill_only_with_a_room() {
        use d2rmm_agent_core::view::{
            AgentView, Connectivity, HotkeysView, PairingView, RoomView, UpdateView,
        };
        let mut view = AgentView {
            pairing: PairingView::Paired,
            connectivity: Connectivity::Connected,
            room: None,
            update: UpdateView::Idle,
            ready_check_open: false,
            hotkeys: HotkeysView::of(&HotkeyPair::defaults()),
            last_fill: None,
            hotkey_unavailable: Vec::new(),
            last_press: None,
            diagnostics: None,
            capture: None,
            config_version: 0,
        };
        assert_eq!(wanted_hotkeys(&view), (None, None));
        view.ready_check_open = true;
        let (accept, fill) = wanted_hotkeys(&view);
        assert_eq!(
            accept.map(|key| key.to_string()),
            Some("Ctrl+Shift+A".to_string())
        );
        assert!(fill.is_none());
        view.ready_check_open = false;
        view.room = Some(RoomView {
            game_name: "mmbaalh-12".to_string(),
            needs_reveal: false,
            matched: false,
            confirmed: false,
            elsewhere: false,
        });
        let (accept, fill) = wanted_hotkeys(&view);
        assert!(accept.is_none());
        assert_eq!(
            fill.map(|key| key.to_string()),
            Some("Ctrl+Shift+F".to_string())
        );
        view.hotkeys.fill = "not a key".to_string();
        assert_eq!(
            wanted_hotkeys(&view),
            (None, None),
            "a combination that does not read is never wanted"
        );
    }

    /// What a reporter was told, in order.
    type Reports = std::rc::Rc<std::cell::RefCell<Vec<(HotkeySlot, Option<HotkeyFailure>)>>>;

    /// A reporter that records every call.
    fn reported() -> (Reports, impl Fn(HotkeySlot, Option<HotkeyFailure>)) {
        let log = Reports::default();
        let writer = log.clone();
        (log, move |slot, reason| {
            writer.borrow_mut().push((slot, reason));
        })
    }

    fn registrar_of(
        log: &Recording,
    ) -> impl Fn(HotkeyChoice) -> Box<dyn super::HotkeyRegistrar> + '_ {
        move |choice| {
            Box::new(Recorded {
                choice,
                log: Recording {
                    calls: log.calls.clone(),
                    accept: log.accept,
                    reason: log.reason,
                },
            })
        }
    }

    #[test]
    fn a_refused_registration_is_reported_with_its_reason_and_a_later_success_clears_it() {
        let slot = Slot::new();
        let (log, report) = reported();
        let wanted = HotkeyChoice::parse("Ctrl+Shift+F").ok();
        let accepting = recording(true);

        reconcile_and_report(
            HotkeySlot::Fill,
            &slot,
            wanted,
            &registrar_of(&recording(false)),
            &report,
        );
        assert_eq!(
            *log.borrow(),
            [(HotkeySlot::Fill, Some(HotkeyFailure::Refused))]
        );

        reconcile_and_report(
            HotkeySlot::Fill,
            &slot,
            wanted,
            &registrar_of(&accepting),
            &report,
        );
        assert_eq!(
            *log.borrow(),
            [
                (HotkeySlot::Fill, Some(HotkeyFailure::Refused)),
                (HotkeySlot::Fill, None)
            ]
        );
    }

    #[test]
    fn each_reason_the_registrar_gives_reaches_the_report() {
        for reason in [
            HotkeyFailure::NoManager,
            HotkeyFailure::Refused,
            HotkeyFailure::Unmapped,
        ] {
            let (log, report) = reported();
            reconcile_and_report(
                HotkeySlot::Accept,
                &Slot::new(),
                HotkeyChoice::parse("Ctrl+Shift+A").ok(),
                &registrar_of(&failing(reason)),
                &report,
            );
            assert_eq!(*log.borrow(), [(HotkeySlot::Accept, Some(reason))]);
        }
    }

    #[test]
    fn a_slot_nobody_wants_is_never_unavailable_even_when_the_os_refuses() {
        let slot = Slot::new();
        let (log, report) = reported();
        reconcile_and_report(
            HotkeySlot::Accept,
            &slot,
            None,
            &registrar_of(&recording(false)),
            &report,
        );
        assert_eq!(*log.borrow(), [(HotkeySlot::Accept, None)]);
    }

    #[test]
    fn a_refused_unregistration_of_the_old_key_leaves_the_new_one_unavailable_with_that_reason() {
        let slot = Slot::new();
        let (log, report) = reported();
        reconcile_and_report(
            HotkeySlot::Fill,
            &slot,
            HotkeyChoice::parse("Ctrl+Shift+F").ok(),
            &registrar_of(&recording(true)),
            &report,
        );
        reconcile_and_report(
            HotkeySlot::Fill,
            &slot,
            HotkeyChoice::parse("Alt+G").ok(),
            &registrar_of(&failing(HotkeyFailure::NoManager)),
            &report,
        );
        assert_eq!(
            *log.borrow(),
            [
                (HotkeySlot::Fill, None),
                (HotkeySlot::Fill, Some(HotkeyFailure::NoManager))
            ]
        );
    }

    #[test]
    fn a_failed_main_thread_dispatch_reports_every_wanted_hotkey_with_the_dispatch_reason() {
        let (log, report) = reported();
        let dispatch = Some(HotkeyFailure::Dispatch);
        report_dispatch_failed((None, HotkeyChoice::parse("Ctrl+Shift+F").ok()), &report);
        assert_eq!(*log.borrow(), [(HotkeySlot::Fill, dispatch)]);
        report_dispatch_failed(
            (
                HotkeyChoice::parse("Ctrl+Shift+A").ok(),
                HotkeyChoice::parse("Ctrl+Shift+F").ok(),
            ),
            &report,
        );
        assert_eq!(
            log.borrow()[1..],
            [(HotkeySlot::Accept, dispatch), (HotkeySlot::Fill, dispatch)]
        );
    }

    #[test]
    fn a_press_belongs_to_the_combination_whose_id_it_carries_and_any_other_id_is_unmatched() {
        let pair = HotkeyPair::defaults();
        let id_of = |choice: HotkeyChoice| match choice.to_string().as_str() {
            "Ctrl+Shift+A" => Some(1),
            "Ctrl+Shift+F" => Some(2),
            _ => None,
        };
        assert_eq!(press_of(&pair, &id_of, 1), HotkeyPress::Accept);
        assert_eq!(press_of(&pair, &id_of, 2), HotkeyPress::Fill);
        assert_eq!(press_of(&pair, &id_of, 3), HotkeyPress::Unmatched);
        assert_eq!(
            press_of(&pair, &|_| None, 1),
            HotkeyPress::Unmatched,
            "a combination that maps to no OS key matches nothing"
        );
    }

    #[test]
    fn a_key_is_named_as_the_os_crate_names_it() {
        use d2rmm_agent_domain::typing::HotkeyKey;
        assert_eq!(code_name(HotkeyKey::Letter('F')), "KeyF");
        assert_eq!(code_name(HotkeyKey::Digit('7')), "Digit7");
        assert_eq!(code_name(HotkeyKey::Function(12)), "F12");
    }
}
