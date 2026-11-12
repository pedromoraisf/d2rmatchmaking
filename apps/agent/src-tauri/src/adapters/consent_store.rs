//! The consent flag on this PC (CHR-02, NFR-05): one small JSON settings file in the app's configuration directory. It holds
//! no secret, so it is not in the credential store. A missing, unreadable or unexpected file reads as "no consent": the
//! agent captures nothing until the player says yes (CHR-01).

use std::fs;
use std::path::{Path, PathBuf};

use d2rmm_agent_core::ports::{ConsentStore, StoreError};
use serde_json::{Value, json};

/// The key of the consent flag in the settings file.
const CAPTURE_CONSENT: &str = "captureConsent";

/// The consent flag in a settings file at `path`. With no path (the configuration directory is unknown) it never consents
/// and refuses to save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileConsentStore {
    path: Option<PathBuf>,
}

impl FileConsentStore {
    pub fn new(path: Option<PathBuf>) -> Self {
        Self { path }
    }
}

impl ConsentStore for FileConsentStore {
    fn load(&self) -> bool {
        let Some(path) = &self.path else {
            return false;
        };
        read_consent(path).unwrap_or(false)
    }

    fn save(&self, consent: bool) -> Result<(), StoreError> {
        let path = self.path.as_ref().ok_or(StoreError)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| StoreError)?;
        }
        let text = json!({ CAPTURE_CONSENT: consent }).to_string();
        fs::write(path, text).map_err(|_| StoreError)
    }
}

/// The flag in the file, or `None` when the file is missing, is not JSON, or does not hold a boolean flag.
fn read_consent(path: &Path) -> Option<bool> {
    let text = fs::read_to_string(path).ok()?;
    let settings: Value = serde_json::from_str(&text).ok()?;
    settings.get(CAPTURE_CONSENT)?.as_bool()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use d2rmm_agent_core::ports::ConsentStore;
    use uuid::Uuid;

    use super::FileConsentStore;

    /// A directory no other test uses, removed when the test ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("d2rmm-consent-{}", Uuid::new_v4())))
        }

        fn settings(&self) -> PathBuf {
            self.0.join("settings.json")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn no_settings_file_means_no_consent() {
        let scratch = Scratch::new();
        assert!(!FileConsentStore::new(Some(scratch.settings())).load());
    }

    #[test]
    fn consent_saved_is_read_back_and_withdrawal_is_stored() {
        let scratch = Scratch::new();
        let store = FileConsentStore::new(Some(scratch.settings()));

        store.save(true).expect("the settings file is written");
        assert!(store.load(), "the consent is kept on this PC");

        store.save(false).expect("the settings file is written");
        assert!(!store.load(), "a withdrawal is stored");
    }

    #[test]
    fn a_file_that_is_not_a_consent_reads_as_no_consent() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("the scratch directory is created");
        for text in ["not json", "{}", r#"{"captureConsent":"yes"}"#, "[true]"] {
            fs::write(scratch.settings(), text).expect("the file is written");
            assert!(
                !FileConsentStore::new(Some(scratch.settings())).load(),
                "{text} is no consent"
            );
        }
    }

    #[test]
    fn no_directory_means_no_consent_and_a_refused_save() {
        let store = FileConsentStore::new(None);
        assert!(!store.load());
        assert!(
            store.save(true).is_err(),
            "nothing can be stored without a directory"
        );
    }

    #[test]
    fn the_store_creates_its_directory_on_the_first_save() {
        let scratch = Scratch::new();
        let nested = scratch.0.join("nested");
        let store = FileConsentStore::new(Some(nested.join("settings.json")));

        store
            .save(true)
            .expect("the directory is created and the file written");

        assert!(nested.join("settings.json").is_file());
    }
}
