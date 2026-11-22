//! The clipboard adapter (FR-28, AST-11, AST-14; ADR 010). The one place the agent writes the clipboard: the game name of the
//! room, through Tauri's clipboard plugin, from Rust. It never reads the clipboard, and no capability gives the window the
//! plugin's commands (`capabilities/main.json` grants none).

use d2rmm_agent_core::ports::{Clipboard, ClipboardError};
use d2rmm_agent_domain::typing::TypableName;
use tauri::{AppHandle, Wry, plugin::TauriPlugin};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// The plugin the app registers so `AppHandle` can write the clipboard.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_clipboard_manager::init()
}

/// Writes the game name of the held room to the Windows clipboard.
pub struct TauriClipboard {
    app: AppHandle,
}

impl TauriClipboard {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Clipboard for TauriClipboard {
    fn write(&self, name: &TypableName) -> Result<(), ClipboardError> {
        self.app
            .clipboard()
            .write_text(name.as_str())
            .map_err(|_| ClipboardError)
    }
}
