//! The self-update adapter (design.md § Updates; AGS-24, AGS-25, AGS-26). It asks the Tauri updater plugin for the latest
//! release, installs a newer version when its signature verifies and restarts into it. It is called from Rust only; the
//! window has no updater permission (AGS-22). The default version comparator is kept: an equal or lower version installs
//! nothing.

use d2rmm_agent_core::ports::{UpdateChecker, UpdateFailure, UpdateOutcome};
use tauri::AppHandle;
use tauri_plugin_updater::{Error, UpdaterExt};

/// Checks the latest release with the app's configured endpoint and embedded public key.
#[derive(Debug, Clone)]
pub struct TauriUpdater {
    app: AppHandle,
}

impl TauriUpdater {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl UpdateChecker for TauriUpdater {
    async fn check(&self) -> UpdateOutcome {
        let updater = match self.app.updater() {
            Ok(updater) => updater,
            Err(error) => return UpdateOutcome::Failed(check_failure(&error)),
        };
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => return UpdateOutcome::UpToDate,
            Err(error) => return UpdateOutcome::Failed(check_failure(&error)),
        };
        match update.download_and_install(|_, _| {}, || {}).await {
            // The new version is installed: restart into it.
            Ok(()) => self.app.restart(),
            Err(error) => UpdateOutcome::Failed(install_failure(&error)),
        }
    }
}

/// A failure to read the release: the network is a download problem, anything else a manifest problem.
fn check_failure(error: &Error) -> UpdateFailure {
    match error {
        Error::Reqwest(_) | Error::Network(_) => UpdateFailure::Download,
        _ => UpdateFailure::Manifest,
    }
}

/// A failure to install: a signature that does not verify is the signature failure; the rest is the download.
fn install_failure(error: &Error) -> UpdateFailure {
    match error {
        Error::Minisign(_) => UpdateFailure::Signature,
        _ => UpdateFailure::Download,
    }
}
