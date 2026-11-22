//! The player's "send diagnostics" switch (OBT-14 to OBT-17; NFR-04, NFR-05). One shared flag the span processor and the export
//! loop read, and one small file in the app's configuration directory that keeps it across restarts, apart from the consent,
//! hotkeys and remote-config files. It holds no secret. The default is on: with no file the switch reads as on. A file that exists but cannot be read as a
//! boolean flag reads as off, so a half-written file never turns diagnostics back on after an opt-out (OBT-15).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use d2rmm_agent_core::ports::{DiagnosticsStore, StoreError};
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
}

impl DiagnosticsStore for FileDiagnosticsStore {
    /// The stored choice: on when there is no file (the default); off when a file exists but is unreadable, malformed or
    /// not a boolean flag, the conservative reading once a choice may have been made (OBT-15).
    fn load(&self) -> bool {
        let Some(path) = self.path.as_ref().filter(|path| path.exists()) else {
            return true;
        };
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|settings| settings.get(SEND_DIAGNOSTICS)?.as_bool())
            .unwrap_or(false)
    }

    fn save(&self, on: bool) -> Result<(), StoreError> {
        let path = self.path.as_ref().ok_or(StoreError)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| StoreError)?;
        }
        // Written beside the file and renamed over it, so a crash mid-write leaves the previous choice whole.
        let temporary = path.with_extension("json.tmp");
        let written = fs::write(&temporary, json!({ SEND_DIAGNOSTICS: on }).to_string())
            .and_then(|()| fs::rename(&temporary, path));
        written.map_err(|_| {
            let _ = fs::remove_file(&temporary);
            StoreError
        })
    }
}

/// A store kept in memory, for tests of what composes the switch: `saved` holds a choice, `missing` reads as on, `unreadable`
/// reads as off and refuses a save, and a save that is refused changes nothing.
#[derive(Debug)]
pub struct InMemoryDiagnosticsStore {
    choice: Mutex<Option<bool>>,
    readable: bool,
}

impl InMemoryDiagnosticsStore {
    pub fn saved(on: bool) -> Self {
        Self {
            choice: Mutex::new(Some(on)),
            readable: true,
        }
    }

    pub fn missing() -> Self {
        Self {
            choice: Mutex::new(None),
            readable: true,
        }
    }

    pub fn unreadable() -> Self {
        Self {
            choice: Mutex::new(None),
            readable: false,
        }
    }
}

impl DiagnosticsStore for InMemoryDiagnosticsStore {
    fn load(&self) -> bool {
        if !self.readable {
            return false;
        }
        self.choice
            .lock()
            .ok()
            .and_then(|choice| *choice)
            .unwrap_or(true)
    }

    fn save(&self, on: bool) -> Result<(), StoreError> {
        if !self.readable {
            return Err(StoreError);
        }
        *self.choice.lock().map_err(|_| StoreError)? = Some(on);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use std::sync::atomic::{AtomicU32, Ordering};

    use super::{
        DIAGNOSTICS_FILE, DiagnosticsStore, DiagnosticsSwitch, FileDiagnosticsStore,
        InMemoryDiagnosticsStore,
    };

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
    fn an_existing_file_that_is_not_a_flag_reads_as_off() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("the directory");
        let file = scratch.0.join(DIAGNOSTICS_FILE);
        for text in [
            "",
            "not json",
            "{",
            "{}",
            r#"{"sendDiagnostics":"no"}"#,
            "[]",
        ] {
            fs::write(&file, text).expect("written");
            assert!(!scratch.store().load(), "{text:?} reads as off");
        }
        fs::remove_file(&file).expect("removed");
        assert!(scratch.store().load(), "a missing file still reads as on");
    }

    #[test]
    fn a_file_that_cannot_be_read_reads_as_off() {
        let scratch = Scratch::new();
        fs::create_dir_all(scratch.0.join(DIAGNOSTICS_FILE)).expect("a directory in its place");
        assert!(!scratch.store().load());
    }

    #[test]
    fn a_failed_write_leaves_the_previous_choice() {
        let scratch = Scratch::new();
        let store = scratch.store();
        store.save(false).expect("saved");
        // A directory where the temporary file goes makes the write fail before the rename.
        fs::create_dir_all(scratch.0.join("diagnostics.json.tmp")).expect("a blocker");

        assert!(store.save(true).is_err());
        assert!(!store.load(), "the opt-out still stands");
        assert_eq!(
            fs::read_to_string(scratch.0.join(DIAGNOSTICS_FILE)).expect("the file"),
            r#"{"sendDiagnostics":false}"#
        );
    }

    #[test]
    fn a_save_leaves_no_temporary_file() {
        let scratch = Scratch::new();
        scratch.store().save(true).expect("saved");
        assert!(!scratch.0.join("diagnostics.json.tmp").exists());
    }

    #[test]
    fn with_no_directory_a_save_is_refused() {
        assert!(
            FileDiagnosticsStore::in_directory(None)
                .save(false)
                .is_err()
        );
    }

    #[test]
    fn the_in_memory_store_follows_the_same_contract() {
        assert!(InMemoryDiagnosticsStore::missing().load());
        assert!(!InMemoryDiagnosticsStore::unreadable().load());
        assert!(InMemoryDiagnosticsStore::unreadable().save(true).is_err());
        let store = InMemoryDiagnosticsStore::saved(true);
        store.save(false).expect("saved");
        assert!(!store.load());
        InMemoryDiagnosticsStore::missing()
            .save(false)
            .expect("saved");
    }
}
