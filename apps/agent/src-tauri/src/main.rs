//! App entry: the Tauri shell around the agent core (design.md § App shell). On Windows it builds the real adapters and hands
//! them to `app::run`. Elsewhere it says the agent runs on Windows only and exits with code 1 (AD-073).
#![deny(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
use d2rmm_agent::{adapters, app, channel, config, language_pack, self_check};

#[cfg(windows)]
use std::sync::Arc;

#[cfg(windows)]
use d2rmm_agent_adapters::http::gateway::HttpGateway;
#[cfg(windows)]
use d2rmm_agent_core::groups::{
    Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
};
#[cfg(windows)]
use d2rmm_agent_core::party::PartyPorts;
#[cfg(windows)]
use d2rmm_agent_core::ports::{
    ConsentStore, ProcessSource, ReadError, Rgba, TextReader, TokenStore, WallClock,
};
#[cfg(windows)]
use d2rmm_agent_core::screen_reader::ScreenReader;
#[cfg(windows)]
use d2rmm_agent_core::watch_screen::ScreenPorts;
#[cfg(windows)]
use d2rmm_agent_domain::language::LanguagePack;
#[cfg(windows)]
use d2rmm_agent_domain::vision::{ReadText, Region};
#[cfg(windows)]
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use adapters::system::{RandomIds, SystemClock};
#[cfg(windows)]
use adapters::token_store::KeyringTokenStore;
#[cfg(windows)]
use adapters::toolhelp::ToolhelpProcessSource;
#[cfg(windows)]
use adapters::updater::TauriUpdater;
#[cfg(windows)]
use adapters::window_capture::WindowFrames;
#[cfg(windows)]
use adapters::windows_ocr::WindowsOcr;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(options) = self_check::parse_args(&args) {
        std::process::exit(run_self_check(options));
    }
    app::run(&args, ports);
}

/// `--self-check`: the real engine and health probe behind `self_check::run`. The JSON line goes to stdout and the reasons to
/// stderr; the return value is the exit code. It starts no window and reads no token or consent.
#[cfg(windows)]
fn run_self_check(options: self_check::Options) -> i32 {
    use std::io::Write;
    use std::time::Duration;

    let (channel_name, channel_check) =
        self_check::channel_check(channel::build_channel(), |note| {
            let _ = writeln!(std::io::stderr(), "{note}");
        });
    let mut checks = self_check::run(
        options,
        config::build_api_base(),
        !cfg!(debug_assertions),
        || {
            WindowsOcr::new()
                .map(|_| ())
                .map_err(|error| format!("{error:?}"))
        },
        |base| {
            tauri::async_runtime::block_on(d2rmm_agent_adapters::http::health::check(
                base,
                Duration::from_secs(10),
            ))
            .map_err(|error| error.to_string())
        },
        |note| {
            let _ = writeln!(std::io::stderr(), "{note}");
        },
    );
    checks.push(channel_check);
    let version = app::app_context().package_info().version.to_string();
    let _ = writeln!(
        std::io::stdout(),
        "{}",
        self_check::report_line(channel_name, &version, &checks)
    );
    self_check::exit_code(&checks)
}

/// The port groups of the Windows agent: the HTTP gateway the app built, the Credential Manager token, the toolhelp process
/// names, the en-US OCR reader, the Tauri updater and the system clock and ids.
#[cfg(windows)]
fn ports(app: AppHandle, gateway: Arc<HttpGateway>) -> Groups<HttpGateway> {
    let reader: Arc<dyn TextReader + Send + Sync> = match WindowsOcr::new() {
        Ok(ocr) => Arc::new(ocr),
        Err(_) => Arc::new(NoOcrEngine),
    };
    let tokens: Arc<dyn TokenStore + Send + Sync> = Arc::new(KeyringTokenStore::new());
    let processes: Arc<dyn ProcessSource + Send + Sync> = Arc::new(ToolhelpProcessSource);
    let clock: Arc<dyn WallClock + Send + Sync> = Arc::new(SystemClock);
    // The shipped English file; the domain's built-in pack is the same words, so a file that fails to parse changes nothing.
    let language =
        Arc::new(language_pack::shipped_english().unwrap_or_else(|_| LanguagePack::english()));
    let consent: Arc<dyn ConsentStore + Send + Sync> =
        Arc::new(app::consent_store_in(app.path().app_config_dir().ok()));
    Groups {
        pairing: PairingPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
            clock: Arc::clone(&clock),
        },
        heartbeat: HeartbeatPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
            processes: Arc::clone(&processes),
        },
        screen: ScreenPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
            processes,
            frames: Arc::new(WindowFrames),
            reader: Arc::new(ScreenReader::new(
                Arc::clone(&reader),
                Arc::clone(&language),
            )),
            consent,
            party: PartyPorts {
                read: ReadPorts {
                    reader: Arc::clone(&reader),
                    ids: Arc::new(RandomIds),
                    clock: Arc::clone(&clock),
                    gateway: Arc::clone(&gateway),
                    tokens: Arc::clone(&tokens),
                },
                language: Arc::clone(&language),
            },
        },
        stream: StreamPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
        },
        update: UpdatePorts {
            // Only production updates itself: a preview or staging installer never finds a release (DLP-06).
            updater: if channel::Channel::of(channel::build_channel())
                .is_ok_and(|channel| channel.config().updater)
            {
                Arc::new(TauriUpdater::new(app))
            } else {
                Arc::new(channel::NoUpdater)
            },
        },
        read: ReadPorts {
            reader,
            ids: Arc::new(RandomIds),
            clock,
            gateway,
            tokens,
        },
    }
}

/// The reader of a machine without the en-US OCR engine: every read reports `EngineUnavailable`, which the core treats as
/// "no observation" (AGS-16). It reads nothing.
#[cfg(windows)]
struct NoOcrEngine;

#[cfg(windows)]
impl TextReader for NoOcrEngine {
    fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
        Err(ReadError::EngineUnavailable)
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The D2RMatchMaking agent runs on Windows only.");
    std::process::exit(1);
}
