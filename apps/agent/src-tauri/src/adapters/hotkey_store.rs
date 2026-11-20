//! The two hotkeys on this PC (FR-28, AST-01): one small JSON file in the app's configuration directory, apart from the
//! consent file so neither can overwrite the other. It holds no secret and is never sent. A missing, unreadable or unexpected
//! file reads as "no choice", and the defaults apply.

use std::fs;
use std::path::PathBuf;

use d2rmm_agent_domain::typing::{HotkeyChoice, HotkeyPair};
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

    /// The saved pair, or `None` when there is none or it does not read as two valid, different hotkeys.
    pub fn load(&self) -> Option<HotkeyPair> {
        let text = fs::read_to_string(self.path.as_ref()?).ok()?;
        let value: Value = serde_json::from_str(&text).ok()?;
        let accept = HotkeyChoice::parse(value.get("accept")?.as_str()?).ok()?;
        let fill = HotkeyChoice::parse(value.get("fill")?.as_str()?).ok()?;
        HotkeyPair::new(accept, fill).ok()
    }

    pub fn save(&self, pair: &HotkeyPair) -> Result<(), HotkeysNotSaved> {
        let path = self.path.as_ref().ok_or(HotkeysNotSaved)?;
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory).map_err(|_| HotkeysNotSaved)?;
        }
        let text = json!({ "accept": pair.accept().to_string(), "fill": pair.fill().to_string() })
            .to_string();
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

    use d2rmm_agent_domain::typing::{HotkeyChoice, HotkeyPair};
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
                .save(&HotkeyPair::defaults())
                .is_err()
        );
        assert!(FileHotkeyStore::in_directory(None).load().is_none());
    }

    #[test]
    fn a_saved_pair_is_read_back() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        let pair = HotkeyPair::defaults()
            .with_fill(choice("Alt+G"))
            .expect("a different key")
            .with_accept(choice("Ctrl+Alt+Q"))
            .expect("a different key");

        store.save(&pair).expect("the file is written");

        assert_eq!(store.load(), Some(pair));
    }

    #[test]
    fn saving_replaces_the_file_whole_and_leaves_no_temporary_file() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        let first = HotkeyPair::defaults()
            .with_fill(choice("Alt+G"))
            .expect("a different key");
        let second = HotkeyPair::defaults()
            .with_fill(choice("Alt+H"))
            .expect("a different key");

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
    fn a_swap_of_the_two_defaults_is_read_back() {
        let scratch = Scratch::new();
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        fs::create_dir_all(&scratch.0).expect("the directory");
        fs::write(
            scratch.0.join("hotkeys.json"),
            r#"{"accept":"Ctrl+Shift+F","fill":"Ctrl+Shift+A"}"#,
        )
        .expect("the file");

        let pair = store.load().expect("a valid swap");
        assert_eq!(pair.accept().to_string(), "Ctrl+Shift+F");
        assert_eq!(pair.fill().to_string(), "Ctrl+Shift+A");
    }

    #[test]
    fn a_file_that_does_not_read_as_two_valid_different_hotkeys_gives_no_choice() {
        let scratch = Scratch::new();
        fs::create_dir_all(&scratch.0).expect("the directory");
        let store = FileHotkeyStore::in_directory(Some(scratch.0.clone()));
        for text in [
            "not json",
            "{}",
            r#"{"accept":"Ctrl+Shift+A"}"#,
            r#"{"accept":"A","fill":"Ctrl+Shift+F"}"#,
            r#"{"accept":"Ctrl+Shift+Enter","fill":"Ctrl+Shift+F"}"#,
            r#"{"accept":"Ctrl+Shift+Q","fill":"Ctrl+Shift+Q"}"#,
            r#"{"accept":1,"fill":2}"#,
        ] {
            fs::write(scratch.0.join("hotkeys.json"), text).expect("the file");
            assert!(store.load().is_none(), "{text}");
        }
    }
}
