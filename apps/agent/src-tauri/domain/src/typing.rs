//! The agent's values for FR-28 and RDY-07 (AST-11, AST-08; ADR 010). The agent copies a game name for the player and
//! sends no input to any window: the only text it may write to the clipboard is a `TypableName` (the generated-name
//! shape), and a `HotkeyChoice` is the accept hotkey the player chose. Pure rules: no I/O, no clock.

use std::fmt;

/// The most characters a game name may have (AST-11).
pub const MAX_NAME_LEN: usize = 32;

/// The most digits of the run number in a game name (AST-11).
const MAX_NUMBER_DIGITS: usize = 6;

/// Why a game name is not copied (AST-11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameRefusal {
    Empty,
    TooLong,
    /// Not `mm`, one or more of `a`–`z` and `0`–`9`, `-`, one to six digits.
    WrongShape,
}

/// A game name that may be copied: `mm[a-z0-9]+-[0-9]{1,6}`, at most 32 characters (ADR 017, AST-11).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypableName {
    text: String,
}

impl TypableName {
    pub fn new(name: &str) -> Result<Self, NameRefusal> {
        if name.is_empty() {
            return Err(NameRefusal::Empty);
        }
        if name.len() > MAX_NAME_LEN {
            return Err(NameRefusal::TooLong);
        }
        if !has_shape(name) {
            return Err(NameRefusal::WrongShape);
        }
        Ok(Self {
            text: name.to_string(),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }
}

fn has_shape(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("mm") else {
        return false;
    };
    let Some((activity, number)) = rest.rsplit_once('-') else {
        return false;
    };
    !activity.is_empty()
        && activity
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && (1..=MAX_NUMBER_DIGITS).contains(&number.len())
        && number.bytes().all(|byte| byte.is_ascii_digit())
}

/// The modifier keys of a hotkey (RDY-07).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

impl Modifiers {
    pub fn any(self) -> bool {
        self.ctrl || self.shift || self.alt
    }
}

/// The key of a hotkey: a letter, a digit or a function key. Nothing that confirms or navigates is a `HotkeyKey`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyKey {
    Letter(char),
    Digit(char),
    Function(u8),
}

/// Why a hotkey is refused (RDY-07).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyRefusal {
    /// Plain keys would fire while the player types.
    NoModifier,
    /// Shift alone is not enough: Shift+letter is how the player types capitals, so the hotkey needs Ctrl or Alt too.
    NeedsCtrlOrAlt,
    /// A combination the system or every program uses (copy, paste, close window) or the Windows key.
    Reserved,
    /// Enter, NumpadEnter, Tab, Space, Escape or Backspace: keys that confirm or navigate.
    ConfirmingKey,
    /// Not a letter, a digit or F1–F12, or not readable as a combination.
    UnsupportedKey,
}

/// A hotkey combination the player chose, such as `Ctrl+Shift+A` (RDY-07).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeyChoice {
    pub modifiers: Modifiers,
    pub key: HotkeyKey,
}

impl HotkeyChoice {
    /// Reads `Ctrl+Shift+F`: modifiers `Ctrl`, `Shift`, `Alt` and one key, in any order and case.
    pub fn parse(text: &str) -> Result<Self, HotkeyRefusal> {
        let mut modifiers = Modifiers::default();
        let mut key = None;
        for part in text.split('+').map(str::trim) {
            match part.to_ascii_lowercase().as_str() {
                "win" | "windows" | "meta" | "super" | "cmd" => {
                    return Err(HotkeyRefusal::Reserved);
                }
                "ctrl" | "control" => modifiers.ctrl = true,
                "shift" => modifiers.shift = true,
                "alt" => modifiers.alt = true,
                other => {
                    if key.replace(read_key(other)?).is_some() {
                        return Err(HotkeyRefusal::UnsupportedKey);
                    }
                }
            }
        }
        let key = key.ok_or(HotkeyRefusal::UnsupportedKey)?;
        if !modifiers.any() {
            return Err(HotkeyRefusal::NoModifier);
        }
        if !(modifiers.ctrl || modifiers.alt) {
            return Err(HotkeyRefusal::NeedsCtrlOrAlt);
        }
        if is_reserved(modifiers, key) {
            return Err(HotkeyRefusal::Reserved);
        }
        Ok(Self { modifiers, key })
    }
}

/// Ctrl+C, V, X, A, Z and Alt+F4 on their own: the shortcuts every program, and the window, already answer to.
fn is_reserved(modifiers: Modifiers, key: HotkeyKey) -> bool {
    let only_ctrl = modifiers.ctrl && !modifiers.shift && !modifiers.alt;
    let only_alt = modifiers.alt && !modifiers.shift && !modifiers.ctrl;
    (only_ctrl && matches!(key, HotkeyKey::Letter('C' | 'V' | 'X' | 'A' | 'Z')))
        || (only_alt && key == HotkeyKey::Function(4))
}

fn read_key(name: &str) -> Result<HotkeyKey, HotkeyRefusal> {
    if matches!(
        name,
        "enter" | "return" | "numpadenter" | "tab" | "space" | "escape" | "esc" | "backspace"
    ) {
        return Err(HotkeyRefusal::ConfirmingKey);
    }
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(letter), None) if letter.is_ascii_lowercase() => {
            Ok(HotkeyKey::Letter(letter.to_ascii_uppercase()))
        }
        (Some(digit), None) if digit.is_ascii_digit() => Ok(HotkeyKey::Digit(digit)),
        (Some('f'), Some(_)) => name[1..]
            .parse::<u8>()
            .ok()
            .filter(|number| (1..=12).contains(number))
            .map(HotkeyKey::Function)
            .ok_or(HotkeyRefusal::UnsupportedKey),
        _ => Err(HotkeyRefusal::UnsupportedKey),
    }
}

impl fmt::Display for HotkeyChoice {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.modifiers.ctrl {
            formatter.write_str("Ctrl+")?;
        }
        if self.modifiers.shift {
            formatter.write_str("Shift+")?;
        }
        if self.modifiers.alt {
            formatter.write_str("Alt+")?;
        }
        match self.key {
            HotkeyKey::Letter(letter) => write!(formatter, "{letter}"),
            HotkeyKey::Digit(digit) => write!(formatter, "{digit}"),
            HotkeyKey::Function(number) => write!(formatter, "F{number}"),
        }
    }
}

impl HotkeyRefusal {
    /// The code the window maps to its message for this refusal.
    pub fn code(self) -> &'static str {
        match self {
            Self::NoModifier => "no-modifier",
            Self::NeedsCtrlOrAlt => "needs-ctrl-or-alt",
            Self::Reserved => "reserved",
            Self::ConfirmingKey => "confirming-key",
            Self::UnsupportedKey => "unsupported-key",
        }
    }
}

impl HotkeyChoice {
    /// The default accept hotkey, Ctrl+Shift+A (RDY-07).
    pub fn default_accept() -> Self {
        Self {
            modifiers: Modifiers {
                ctrl: true,
                shift: true,
                alt: false,
            },
            key: HotkeyKey::Letter('A'),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{HotkeyChoice, HotkeyKey, HotkeyRefusal, MAX_NAME_LEN, NameRefusal, TypableName};

    const ACTIVITIES: [&str; 9] = [
        "baal", "chaos", "cows", "tz", "heralds", "duel1v1", "duel2v2", "arena6", "mephisto",
    ];

    #[test]
    fn every_name_the_server_generates_is_typable() {
        for activity in ACTIVITIES {
            for code in ["n", "m", "h"] {
                for number in [1, 12, 999_999] {
                    let name = format!("mm{activity}{code}-{number}");
                    let typable = TypableName::new(&name).expect(&name);
                    assert_eq!(typable.as_str(), name);
                }
            }
        }
    }

    #[test]
    fn a_name_of_another_shape_is_refused() {
        for (name, refusal) in [
            ("", NameRefusal::Empty),
            ("/exit", NameRefusal::WrongShape),
            ("mmbaalh-12 http://x.io", NameRefusal::WrongShape),
            ("MMBAALH-12", NameRefusal::WrongShape),
            ("mmBaalh-12", NameRefusal::WrongShape),
            ("mmbaalh-", NameRefusal::WrongShape),
            ("mmbaalh-1234567", NameRefusal::WrongShape),
            ("mmbaalh-1a", NameRefusal::WrongShape),
            ("mm-12", NameRefusal::WrongShape),
            ("baalh-12", NameRefusal::WrongShape),
            ("mmbaalh12", NameRefusal::WrongShape),
            ("mmbaalh-12\n", NameRefusal::WrongShape),
            ("mmbaalh 12", NameRefusal::WrongShape),
            ("mmbaal\u{2011}h-12", NameRefusal::WrongShape),
            ("mmbaalh-１２", NameRefusal::WrongShape),
        ] {
            assert_eq!(TypableName::new(name).err(), Some(refusal), "{name:?}");
        }
    }

    #[test]
    fn the_longest_name_is_32_characters_and_one_more_is_refused() {
        let activity = "a".repeat(MAX_NAME_LEN - "mm-1".len());
        let longest = format!("mm{activity}-1");
        assert_eq!(longest.len(), MAX_NAME_LEN);
        assert!(TypableName::new(&longest).is_ok());
        let too_long = format!("mma{activity}-1");
        assert_eq!(
            TypableName::new(&too_long).err(),
            Some(NameRefusal::TooLong)
        );
    }

    #[test]
    fn a_hotkey_reads_in_any_order_and_case_and_prints_in_one_form() {
        for text in ["Ctrl+Shift+F", "shift+ctrl+f", " CTRL + SHIFT + f "] {
            let choice = HotkeyChoice::parse(text).expect(text);
            assert_eq!(choice.to_string(), "Ctrl+Shift+F");
            assert_eq!(choice.key, HotkeyKey::Letter('F'));
        }
        assert_eq!(
            HotkeyChoice::parse("Alt+F12").expect("F12").to_string(),
            "Alt+F12"
        );
        assert_eq!(
            HotkeyChoice::parse("Ctrl+7").expect("a digit").to_string(),
            "Ctrl+7"
        );
    }

    #[test]
    fn a_hotkey_with_no_modifier_is_refused() {
        assert_eq!(
            HotkeyChoice::parse("F").err(),
            Some(HotkeyRefusal::NoModifier)
        );
        assert_eq!(
            HotkeyChoice::parse("F5").err(),
            Some(HotkeyRefusal::NoModifier)
        );
    }

    #[test]
    fn a_hotkey_needs_ctrl_or_alt_not_shift_alone() {
        for text in ["Shift+G", "Shift+F5", "Shift+7"] {
            assert_eq!(
                HotkeyChoice::parse(text).err(),
                Some(HotkeyRefusal::NeedsCtrlOrAlt),
                "{text}"
            );
        }
        for text in [
            "Ctrl+G",
            "Alt+G",
            "Ctrl+Shift+G",
            "Alt+Shift+G",
            "Ctrl+Alt+G",
        ] {
            assert!(HotkeyChoice::parse(text).is_ok(), "{text}");
        }
    }

    #[test]
    fn the_shortcuts_every_program_answers_to_and_the_windows_key_are_reserved() {
        for text in [
            "Ctrl+C",
            "Ctrl+V",
            "Ctrl+X",
            "Ctrl+A",
            "Ctrl+Z",
            "ctrl+c",
            "Alt+F4",
            "Win+G",
            "Win+Ctrl+G",
            "Meta+Ctrl+F",
            "Super+Alt+F",
            "Windows+Ctrl+Q",
        ] {
            assert_eq!(
                HotkeyChoice::parse(text).err(),
                Some(HotkeyRefusal::Reserved),
                "{text}"
            );
        }
        // Only the bare combination is reserved: the same key with another modifier added is free (the default is Ctrl+Shift+A).
        for text in [
            "Ctrl+Shift+A",
            "Ctrl+Alt+C",
            "Ctrl+Shift+Z",
            "Alt+Shift+F4",
            "Ctrl+F4",
            "Alt+F5",
            "Ctrl+B",
        ] {
            assert!(HotkeyChoice::parse(text).is_ok(), "{text}");
        }
    }

    #[test]
    fn a_hotkey_on_a_confirming_or_navigating_key_is_refused() {
        for key in [
            "Enter",
            "Return",
            "NumpadEnter",
            "Tab",
            "Space",
            "Escape",
            "Esc",
            "Backspace",
        ] {
            let text = format!("Ctrl+Shift+{key}");
            assert_eq!(
                HotkeyChoice::parse(&text).err(),
                Some(HotkeyRefusal::ConfirmingKey),
                "{text}"
            );
        }
    }

    #[test]
    fn a_hotkey_that_is_not_a_letter_digit_or_function_key_is_refused() {
        for text in [
            "Ctrl+Shift",
            "Ctrl+Shift+",
            "Ctrl+Shift+F0",
            "Ctrl+Shift+F13",
            "Ctrl+Shift+F+G",
            "Ctrl+Shift+/",
            "Ctrl+Shift+Home",
            "Ctrl+Shift+10",
            "",
            "+",
            "Ctrl+Fx",
        ] {
            assert_eq!(
                HotkeyChoice::parse(text).err(),
                Some(HotkeyRefusal::UnsupportedKey),
                "{text:?}"
            );
        }
    }

    #[test]
    fn a_refusal_has_the_name_the_window_uses() {
        let codes: Vec<&str> = [
            HotkeyRefusal::NoModifier,
            HotkeyRefusal::NeedsCtrlOrAlt,
            HotkeyRefusal::Reserved,
            HotkeyRefusal::ConfirmingKey,
            HotkeyRefusal::UnsupportedKey,
        ]
        .map(HotkeyRefusal::code)
        .to_vec();
        assert_eq!(
            codes,
            [
                "no-modifier",
                "needs-ctrl-or-alt",
                "reserved",
                "confirming-key",
                "unsupported-key"
            ]
        );
    }

    #[test]
    fn the_default_accept_hotkey_is_ctrl_shift_a() {
        assert_eq!(HotkeyChoice::default_accept().to_string(), "Ctrl+Shift+A");
        assert_eq!(
            HotkeyChoice::parse("ctrl+shift+a").expect("valid"),
            HotkeyChoice::default_accept()
        );
    }
}
