//! The app wiring (design.md § Runtime, state and telemetry, § App shell; AGS-05, AGS-34, AD-073). `run` starts telemetry,
//! reads the build configuration, starts the core runtime and sends every `AgentView` to the window as `agent-state`. The
//! "Get a new code" command reaches the runtime through `CodeRequester`, so a fake can stand in for the handle in a test.
//! The Tauri shell exists on Windows only; this module is compiled where something uses it (Windows and tests), so no
//! item is left dead on another target.
#![cfg(any(windows, test))]

use d2rmm_agent_core::runtime::Handle;
use tauri::Url;

/// What the command handler needs from the runtime: a request for one new pairing code.
pub trait CodeRequester {
    fn request_new_code(&self);
}

impl CodeRequester for Handle {
    fn request_new_code(&self) {
        self.get_new_code();
    }
}

/// The "Get a new code" command: one request to the runtime. The runtime honours it only while the code is paused (AGS-34).
pub fn handle_get_new_code(requester: &impl CodeRequester) {
    requester.request_new_code();
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

    use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};

    use d2rmm_agent_core::context::Adapters;
    use d2rmm_agent_core::ports::StateSink;
    use d2rmm_agent_core::runtime::{Handle, Runtime};
    use d2rmm_agent_core::telemetry::{self, Mode};
    use d2rmm_agent_core::view::AgentView;

    use super::{app_context, handle_get_new_code, is_app_url};
    use crate::adapters::http;
    use crate::config;
    use crate::fixture_read;

    /// The label of the one window declared in tauri.conf.json. It is created in `setup` so its navigation is restricted.
    const MAIN_WINDOW: &str = "main";
    /// The event that carries every `AgentView` to the window.
    const AGENT_STATE: &str = "agent-state";

    /// Asks the runtime for a new pairing code.
    #[tauri::command]
    fn get_new_code(handle: State<'_, Arc<Handle>>) {
        handle_get_new_code(&**handle);
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
        #[cfg(feature = "fixture-read")]
        fixture: Option<fixture_read::FixtureSink>,
    }

    impl WindowSink {
        #[cfg(feature = "fixture-read")]
        fn attach(&self, handle: Arc<Handle>) {
            if let Some(fixture) = &self.fixture {
                fixture.attach(handle);
            }
        }

        #[cfg(not(feature = "fixture-read"))]
        fn attach(&self, _handle: Arc<Handle>) {}

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
            let _ = self.app.emit(AGENT_STATE, view);
        }
    }

    /// Starts the agent and the window. `build` supplies the ports, given the app handle (for the updater) and the state
    /// sink. A bad build configuration or a bad fixture path ends the process with exit code 1; a rejected flag exits 2.
    pub fn run(
        args: &[String],
        build: impl FnOnce(AppHandle, Arc<dyn StateSink + Send + Sync>) -> Adapters + Send + 'static,
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
        telemetry::init(mode).expect("the telemetry subscriber is installed once");

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
            .invoke_handler(tauri::generate_handler![get_new_code])
            .setup(move |app| {
                let app_handle = app.handle().clone();
                let window_sink = Arc::new(WindowSink {
                    app: app_handle.clone(),
                    #[cfg(feature = "fixture-read")]
                    fixture,
                });
                let sink: Arc<dyn StateSink + Send + Sync> = window_sink.clone();
                let adapters = build(app_handle, sink);

                let version = app.package_info().version.to_string();
                let core_config = config::core_config(&version, api_base.clone());
                let client = http::client(&api_base)?;
                let handle = Arc::new(tauri::async_runtime::block_on(async move {
                    Runtime::start(&core_config, client, adapters)
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
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use tauri::Url;

    use super::{CodeRequester, app_context, handle_get_new_code, is_app_url};
    use crate::config;

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
        let base =
            config::api_base(Some("https://api.example.test"), true).expect("https is accepted");
        let core_config = config::core_config(&version, base);
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
}
