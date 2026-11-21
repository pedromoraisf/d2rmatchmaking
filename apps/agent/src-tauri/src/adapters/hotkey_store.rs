//! The accept hotkey on this PC (RDY-07): one small JSON file in the app's configuration directory, apart from the
//! consent file so neither can overwrite the other. It holds no secret and is never sent. A missing, unreadable or unexpected
//! file reads as "no choice", and the defaults apply.

use std::fs;
use std::path::PathBuf;

use d2rmm_agent_domain::typing::HotkeyChoice;
use serde_json::{Value, json};

/// The file that holds the hotkeys, in the app's configuration directory.
pub const HOTKEYS_FILE: &str = "hotkeys.json";

/// The hotkeys file at `path`. With no path (the configuration directory is unknown) nothing is read and saving fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHotkeyStore {
    path: Option<PathBuf>,
}

/// The file could not be written. It carries no path or cause (AGS-09).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeysNotSaved;

impl FileHotkeyStore {
    pub fn in_directory(directory: Option<PathBuf>) -> Self {
        Self {
            path: directory.map(|directory| directory.join(HOTKEYS_FILE)),
        }
    }

    /// The saved accept hotkey, or `None` when there is none or it does not read as a valid one. A file an older version
    /// wrote with a second key keeps its accept key; the rest is ignored.
    pub fn load(&self) -> Option<HotkeyChoice> {
        let text = fs::read_to_string(self.path.as_ref()?).ok()?;
        let value: Value = serde_json::from_str(&text).ok()?;
        HotkeyChoice::parse(value.get("accept")?.as_str()?).ok()
    }

    pub fn save(&self, accept: &HotkeyChoice) -> Result<(), HotkeysNotSaved> {
        let path = self.path.as_ref().ok_or(HotkeysNotSaved)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| HotkeysNotSaved)?;
        }
        let text = json!({ "accept": accept.to_string() }).to_string();
        // Written to a temporary file next to the real one and renamed over it, so a crash in the middle never leaves a
        // half-written file that reads as "no choice" and silently drops the player's keys.
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, text).map_err(|_| HotkeysNotSaved)?;
        fs::rename(&temporary, path).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            HotkeysNotSaved
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use d2rmm_agent_domain::typing::HotkeyChoice;
    use uuid::Uuid;

    use super::FileHotkeyStore;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("d2rmm-hotkeys-{}", Uuid::new_v4())))
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn choice(text: &str) -> HotkeyChoice {
        HotkeyChoice::parse(text).expect("a valid combination")
    }

    #[test]
    fn no_file_means_no_choice_and_no_directory_cannot_save() {
        let scratch = Scratch::new();
        assert!(
            FileHotkeyStore::in_directory(Some(scratch.0.clone()))
                .load()
                .is_none()
        );
        assert!(
            FileHotkeyStore::in_directory(None)
                .save(&HotkeyChoice::default_accept())
                .is_err()
        );
        assert!(FileHotkeyStore::in_directory(None).load().is_none());
    }

    #[test]
    fn a_saved_hotkey_is_read_back() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        let accept = choice("Ctrl+Alt+Q");

        store.save(&accept).expect("the file is written");

        assert_eq!(store.load(), Some(accept));
    }

    #[test]
    fn saving_replaces_the_file_whole_and_leaves_no_temporary_file() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        let (first, second) = (choice("Alt+G"), choice("Alt+H"));

        store.save(&first).expect("the file is written");
        store.save(&second).expect("the file is replaced");

        assert_eq!(store.load(), Some(second));
        let names: Vec<String> = fs::read_dir(&scratch.0)
            .expect("the directory")
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .collect();
        assert_eq!(names, ["hotkeys.json"], "no temporary file is left");
    }

    #[test]
    fn a_file_an_older_version_wrote_keeps_its_accept_key() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        fs::create_dir_all(&scratch.0).expect("the directory");
        fs::write(
            scratch.0.join("hotkeys.json"),
            r#"{"accept":"Ctrl+Alt+Q","fill":"Ctrl+Shift+F"}"#,
        )
        .expect("the file");

        assert_eq!(
            store.load().map(|key| key.to_string()),
            Some("Ctrl+Alt+Q".to_string())
        );
    }

    #[test]
    fn a_file_that_does_not_read_as_a_valid_hotkey_gives_no_choice() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("the directory");
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        for text in [
            "not json",
            "{}",
            r#"{"accept":"A"}"#,
            r#"{"accept":"Ctrl+Shift+Enter"}"#,
            r#"{"accept":1}"#,
        ] {
            fs::write(scratch.0.join("hotkeys.json"), text).expect("the file");
            assert!(store.load().is_none(), "{text}");
        }
    }
}
