//! The app wiring (design.md § Runtime, state and telemetry, § App shell; AGS-05, AGS-34, AD-073). `run` starts telemetry,
//! reads the build configuration, starts the core runtime and sends every `AgentView` to the window as `agent-state`. The
//! "Get a new code" command reaches the runtime through `CodeRequester`, so a fake can stand in for the handle in a test.
//! The Tauri shell exists on Windows only; this module is compiled where something uses it (Windows and tests), so no
//! item is left dead on another target.
#![cfg(any(windows, test))]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use d2rmm_agent_adapters::http::gateway::HttpGateway;
use d2rmm_agent_core::ports::{ConsentStore, StoreError};
use d2rmm_agent_core::runtime::Handle;
use tauri::Url;

use crate::adapters::consent_store::FileConsentStore;

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
    use std::sync::atomic::AtomicBool;

    use global_hotkey::hotkey::{Code, HotKey, Modifiers};
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};

    use d2rmm_agent_adapters::config::ApiBase;
    use d2rmm_agent_adapters::http::api_client::ApiClient;
    use d2rmm_agent_adapters::http::gateway::HttpGateway;
    use d2rmm_agent_adapters::telemetry::relay_client::HeaderSource;
    use d2rmm_agent_adapters::telemetry::{self, ExportConfig, Mode};
    use d2rmm_agent_core::groups::Groups;
    use d2rmm_agent_core::ports::{StateSink, TokenStore};
    use d2rmm_agent_core::runtime::{Handle, Runtime};
    use d2rmm_agent_core::secret::Secret;
    use d2rmm_agent_core::view::AgentView;

    use super::{
        FileConsentStore, HotkeyRegistrar, app_context, consent_store_in, handle_get_consent,
        handle_get_new_code, handle_set_consent, is_app_url, sync_hotkey,
    };
    use crate::adapters::token_store::KeyringTokenStore;
    use crate::config;
    use crate::fixture_read;
    use d2rmm_agent_adapters::http;

    /// The global shortcut that accepts the open ready check (RDY-07). Fixed in F1; configurable in F2 (FR-28). The agent
    /// sends the API one call with it and never sends input to the game or to any window (ADR 010).
    fn ready_check_hotkey() -> HotKey {
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyA)
    }

    thread_local! {
        /// The OS hotkey manager. On Windows it owns a hidden window and must live on the thread that runs the event loop,
        /// the Tauri main thread: it is created there, in `setup`, and used only there (`run_on_main_thread`).
        static MANAGER: RefCell<Option<GlobalHotKeyManager>> = const { RefCell::new(None) };
    }

    /// The hotkey of the app: every registration runs on the main thread, where the manager lives.
    struct MainThreadHotkey {
        app: AppHandle,
        registered: Arc<AtomicBool>,
    }

    impl MainThreadHotkey {
        /// Registers or unregisters on the main thread, then records what the OS accepted.
        fn request(&self, open: bool) {
            let registered = self.registered.clone();
            let _ = self.app.run_on_main_thread(move || {
                sync_hotkey(&registered, open, &LocalManager);
            });
        }
    }

    /// The manager of the main thread, as a registrar.
    struct LocalManager;

    impl HotkeyRegistrar for LocalManager {
        fn set(&self, on: bool) -> bool {
            MANAGER.with(|manager| match manager.borrow().as_ref() {
                Some(manager) if on => manager.register(ready_check_hotkey()).is_ok(),
                Some(manager) => manager.unregister(ready_check_hotkey()).is_ok(),
                None => false,
            })
        }
    }

    /// Creates the manager on the calling thread, which must be the main thread, and forwards each press to the runtime.
    fn start_hotkey(app: &AppHandle) {
        MANAGER.with(|manager| *manager.borrow_mut() = GlobalHotKeyManager::new().ok());
        let app = app.clone();
        let id = ready_check_hotkey().id();
        std::thread::spawn(move || {
            while let Ok(event) = GlobalHotKeyEvent::receiver().recv() {
                on_hotkey(&app, id, &event);
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
        /// Whether the hotkey is registered now: it is registered exactly while a ready check is open (RDY-07).
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
            self.hotkey.request(view.ready_check_open);
            let _ = self.app.emit(AGENT_STATE, view);
        }
    }

    /// The hotkey's press: the runtime accepts the held ready check at this instant (RDY-02, RDY-07). Only a press of the
    /// ready-check combination does anything.
    fn on_hotkey(app: &AppHandle, id: u32, event: &GlobalHotKeyEvent) {
        if event.state != HotKeyState::Pressed || event.id != id {
            return;
        }
        if let Some(handle) = app.try_state::<Arc<Handle<HttpGateway>>>() {
            handle.accept_ready_check();
        }
    }

    /// The sampling ratio of the agent's spans: the default of the API and the site (OBS-43).
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

    /// The export configuration of this build. It is `Some` only when the build sets `D2RMM_TELEMETRY=on` at compile
    /// time (AD-098): a debug profile alone exports nothing.
    fn export_config(api_base: &ApiBase, version: &str) -> Option<ExportConfig> {
        if option_env!("D2RMM_TELEMETRY") != Some("on") {
            return None;
        }
        let base = api_base.url().as_str().trim_end_matches('/');
        Some(ExportConfig {
            endpoint: format!("{base}/v1/telemetry/traces"),
            headers: Arc::new(TokenHeaders {
                tokens: Arc::new(KeyringTokenStore::new()),
                version: version.to_string(),
            }),
            ratio: SAMPLER_RATIO,
            agent_version: version.to_string(),
            environment: if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            }
            .to_string(),
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
                set_consent
            ])
            .setup(move |app| {
                let app_handle = app.handle().clone();
                let window_sink = Arc::new(WindowSink {
                    app: app_handle.clone(),
                    hotkey: MainThreadHotkey {
                        app: app_handle.clone(),
                        registered: Arc::new(AtomicBool::new(false)),
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
                let groups = build(app_handle, gateway);
                let handle = Arc::new(tauri::async_runtime::block_on(async move {
                    Runtime::start(&core_config, sink, groups)
                }));
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

    use super::{
        CodeRequester, app_context, consent_store_in, handle_get_consent, handle_get_new_code,
        handle_set_consent, is_app_url,
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
}
