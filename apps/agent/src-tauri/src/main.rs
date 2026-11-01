//! App entry: the Tauri shell around the agent core (design.md § App shell). On Windows it builds the real adapters and hands
//! them to `app::run`. Elsewhere it says the agent runs on Windows only and exits with code 1 (AD-073).
#![deny(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adapters;
mod app;
#[cfg(any(windows, test))]
mod config;
#[cfg(any(windows, test))]
mod fixture_read;

#[cfg(windows)]
use std::sync::Arc;

#[cfg(windows)]
use d2rmm_agent_core::context::{
    Groups, HeartbeatPorts, PairingPorts, ReadPorts, StreamPorts, UpdatePorts,
};
#[cfg(windows)]
use d2rmm_agent_core::gateway::http::HttpGateway;
#[cfg(windows)]
use d2rmm_agent_core::ports::{
    ProcessSource, ReadError, ReadText, Region, Rgba, TextReader, TokenStore, WallClock,
};
#[cfg(windows)]
use tauri::AppHandle;

#[cfg(windows)]
use adapters::system::{RandomIds, SystemClock};
#[cfg(windows)]
use adapters::token_store::KeyringTokenStore;
#[cfg(windows)]
use adapters::toolhelp::ToolhelpProcessSource;
#[cfg(windows)]
use adapters::updater::TauriUpdater;
#[cfg(windows)]
use adapters::windows_ocr::WindowsOcr;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    app::run(&args, ports);
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
    Groups {
        pairing: PairingPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
            clock: Arc::clone(&clock),
        },
        heartbeat: HeartbeatPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
            processes,
        },
        stream: StreamPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens),
        },
        update: UpdatePorts {
            updater: Arc::new(TauriUpdater::new(app)),
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
