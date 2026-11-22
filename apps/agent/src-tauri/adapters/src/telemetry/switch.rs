//! The player's "send diagnostics" switch (OBT-14 to OBT-17; NFR-04, NFR-05). One shared flag the span processor and the export
//! loop read, and one small file in the app's configuration directory that keeps it across restarts, apart from the consent,
//! hotkeys and remote-config files. It holds no secret. The default is on; a missing, unreadable or unexpected file reads as on.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use d2rmm_agent_core::ports::StoreError;
use serde_json::{Value, json};

/// The file that holds the switch, in the app's configuration directory.
pub const DIAGNOSTICS_FILE: &str = "diagnostics.json";
/// The key of the flag in the file.
const SEND_DIAGNOSTICS: &str = "sendDiagnostics";

/// The live flag. Clones share it, so a change made from the window reaches the exporter at once, without a restart.
#[derive(Debug, Clone)]
pub struct DiagnosticsSwitch(Arc<AtomicBool>);

impl DiagnosticsSwitch {
    pub fn new(on: bool) -> Self {
        Self(Arc::new(AtomicBool::new(on)))
    }

    /// The default: diagnostics are sent.
    pub fn on() -> Self {
        Self::new(true)
    }

    pub fn is_on(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    pub fn set(&self, on: bool) {
        self.0.store(on, Ordering::SeqCst);
    }
}

impl Default for DiagnosticsSwitch {
    fn default() -> Self {
        Self::on()
    }
}

/// The switch in a file at `directory`. With no directory nothing is kept and the switch reads as on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDiagnosticsStore {
    path: Option<PathBuf>,
}

impl FileDiagnosticsStore {
    pub fn in_directory(directory: Option<PathBuf>) -> Self {
        Self {
            path: directory.map(|directory| directory.join(DIAGNOSTICS_FILE)),
        }
    }

    /// The stored choice; on when there is none or the file is unreadable or not a boolean flag (OBT-15).
    pub fn load(&self) -> bool {
        self.read().unwrap_or(true)
    }

    fn read(&self) -> Option<bool> {
        let text = fs::read_to_string(self.path.as_ref()?).ok()?;
        let settings: Value = serde_json::from_str(&text).ok()?;
        settings.get(SEND_DIAGNOSTICS)?.as_bool()
    }

    pub fn save(&self, on: bool) -> Result<(), StoreError> {
        let path = self.path.as_ref().ok_or(StoreError)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| StoreError)?;
        }
        fs::write(path, json!({ SEND_DIAGNOSTICS: on }).to_string()).map_err(|_| StoreError)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use std::sync::atomic::{AtomicU32, Ordering};

    use super::{DIAGNOSTICS_FILE, DiagnosticsSwitch, FileDiagnosticsStore};

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let number = NEXT.fetch_add(1, Ordering::SeqCst);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos());
            Self(std::env::temp_dir().join(format!("d2rmm-diagnostics-{nanos}-{number}")))
        }

        fn store(&self) -> FileDiagnosticsStore {
            FileDiagnosticsStore::in_directory(Some(self.0.clone()))
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_switch_is_on_by_default() {
        assert!(DiagnosticsSwitch::default().is_on());
        assert!(DiagnosticsSwitch::on().is_on());
        assert!(!DiagnosticsSwitch::new(false).is_on());
    }

    #[test]
    fn a_change_reaches_every_clone_at_once() {
        let switch = DiagnosticsSwitch::on();
        let other = switch.clone();

        switch.set(false);
        assert!(!other.is_on());
        other.set(true);
        assert!(switch.is_on());
    }

    #[test]
    fn with_no_file_the_choice_is_on() {
        let scratch = Scratch::new();
        assert!(scratch.store().load());
        assert!(FileDiagnosticsStore::in_directory(None).load());
    }

    #[test]
    fn the_saved_choice_is_read_back() {
        let scratch = Scratch::new();
        let store = scratch.store();

        store.save(false).expect("saved");
        assert!(!store.load());
        assert!(!scratch.store().load(), "a new store reads the same file");
        store.save(true).expect("saved again");
        assert!(store.load());
    }

    #[test]
    fn an_unreadable_or_unexpected_file_reads_as_on() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("the directory");
        let file = scratch.0.join(DIAGNOSTICS_FILE);
        for text in ["not json", "{}", r#"{"sendDiagnostics":"no"}"#, "[]"] {
            fs::write(&file, text).expect("written");
            assert!(scratch.store().load(), "{text:?} reads as on");
        }
    }

    #[test]
    fn with_no_directory_a_save_is_refused() {
        assert!(
            FileDiagnosticsStore::in_directory(None)
                .save(false)
                .is_err()
        );
    }
}
