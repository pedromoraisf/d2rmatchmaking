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
use d2rmm_agent_core::context::Adapters;
#[cfg(windows)]
use d2rmm_agent_core::ports::{ReadError, ReadText, Region, Rgba, StateSink, TextReader};
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

/// The ports of the Windows agent: the Credential Manager token, the toolhelp process names, the en-US OCR reader, the
/// Tauri updater and the system clock and ids.
#[cfg(windows)]
fn ports(app: AppHandle, sink: Arc<dyn StateSink + Send + Sync>) -> Adapters {
    let reader: Arc<dyn TextReader + Send + Sync> = match WindowsOcr::new() {
        Ok(ocr) => Arc::new(ocr),
        Err(_) => Arc::new(NoOcrEngine),
    };
    Adapters {
        tokens: Arc::new(KeyringTokenStore::new()),
        processes: Arc::new(ToolhelpProcessSource),
        reader,
        ids: Arc::new(RandomIds),
        updater: Arc::new(TauriUpdater::new(app)),
        clock: Arc::new(SystemClock),
        sink,
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
