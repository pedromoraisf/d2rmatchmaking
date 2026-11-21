//! The last good remote configuration on this PC (remote-config RCF-06): one small JSON file in the app's configuration
//! directory, apart from the consent and hotkeys files. It holds no secret. It is written whole or not at all, and read back
//! through the same rules as a fetched body (`from_wire`), so a file that is corrupted, truncated or edited by hand is deleted
//! and the defaults apply.

use std::fs;
use std::path::PathBuf;

use d2rmm_agent_core::ports::{ConfigStore, StoreError};
use d2rmm_agent_domain::remote_config::MAX_BODY_BYTES;

/// The file that holds the last good body, in the app's configuration directory.
pub const CONFIG_FILE: &str = "remote-config.json";

/// The configuration file at `path`. With no directory (the configuration directory is unknown) nothing is read or kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileConfigStore {
    path: Option<PathBuf>,
}

impl FileConfigStore {
    pub fn in_directory(directory: Option<PathBuf>) -> Self {
        Self {
            path: directory.map(|directory| directory.join(CONFIG_FILE)),
        }
    }
}

impl ConfigStore for FileConfigStore {
    /// The stored body. A file over the size limit is not read: it reads as one byte over, which the rules refuse.
    fn load(&self) -> Option<Vec<u8>> {
        let path = self.path.as_ref()?;
        let length = fs::metadata(path).ok()?.len();
        if length > MAX_BODY_BYTES as u64 {
            return Some(vec![0; MAX_BODY_BYTES + 1]);
        }
        fs::read(path).ok()
    }

    fn save(&self, body: &[u8]) -> Result<(), StoreError> {
        let path = self.path.as_ref().ok_or(StoreError)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| StoreError)?;
        }
        // A temporary file next to the real one, renamed over it: a crash in the middle never leaves half a body.
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, body).map_err(|_| StoreError)?;
        fs::rename(&temporary, path).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            StoreError
        })
    }

    fn delete(&self) {
        if let Some(path) = &self.path {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use d2rmm_agent_core::ports::ConfigStore;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::{CONFIG_FILE, FileConfigStore};
    use crate::remote_config::wire_of;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let number = NEXT.fetch_add(1, Ordering::SeqCst);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos());
            Self(std::env::temp_dir().join(format!("d2rmm-config-{nanos}-{number}")))
        }

        fn store(&self) -> FileConfigStore {
            FileConfigStore::in_directory(Some(self.0.clone()))
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_body_saved_is_the_body_loaded() {
        let scratch = Scratch::new();
        let store = scratch.store();
        assert_eq!(store.load(), None);
        store.save(br#"{"version":5}"#).expect("saved");
        assert_eq!(store.load().as_deref(), Some(&br#"{"version":5}"#[..]));
        store.save(br#"{"version":6}"#).expect("saved again");
        assert_eq!(store.load().as_deref(), Some(&br#"{"version":6}"#[..]));
    }

    #[test]
    fn a_save_leaves_no_temporary_file() {
        let scratch = Scratch::new();
        scratch.store().save(b"{}").expect("saved");
        let names: Vec<_> = fs::read_dir(&scratch.0)
            .expect("the directory")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(CONFIG_FILE)]);
    }

    #[test]
    fn delete_removes_the_file_and_is_quiet_when_there_is_none() {
        let scratch = Scratch::new();
        let store = scratch.store();
        store.delete();
        store.save(b"{}").expect("saved");
        store.delete();
        assert_eq!(store.load(), None);
    }

    #[test]
    fn with_no_directory_nothing_is_read_and_saving_fails() {
        let store = FileConfigStore::in_directory(None);
        assert_eq!(store.load(), None);
        assert!(store.save(b"{}").is_err());
        store.delete();
    }

    #[test]
    fn a_file_over_the_size_limit_reads_as_a_body_the_rules_refuse() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("a directory");
        fs::write(scratch.0.join(CONFIG_FILE), vec![b'a'; 70_000]).expect("a big file");
        let body = scratch.store().load().expect("a body");
        assert_eq!(wire_of(&body), None);
    }

    #[test]
    fn a_file_at_the_size_limit_is_read_whole() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("a directory");
        fs::write(scratch.0.join(CONFIG_FILE), vec![b'a'; 65_536]).expect("a file");
        assert_eq!(scratch.store().load().map(|body| body.len()), Some(65_536));
    }

    #[test]
    fn an_unreadable_path_reads_as_none() {
        let scratch = Scratch::new();
        // The path is a directory, not a file.
        fs::create_dir_all(scratch.0.join(CONFIG_FILE)).expect("a directory");
        assert_eq!(scratch.store().load(), None);
    }
}
