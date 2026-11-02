//! The configuration the app hands to the core: the agent version (AGS-04). The API base lives with the HTTP adapters.

/// What the core receives at start. The app reads the version from `tauri.conf.json`, never from `CARGO_PKG_VERSION`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub version: String,
}
