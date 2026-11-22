//! The accept hotkey's values (RDY-07, AST-01): the combination the player chose, such as `Ctrl+Shift+A`. The agent registers it
//! with the OS only while a ready check is open and never sends input to the game (ADR 010). Enter, Tab, Space, Escape and
//! Backspace are not representable as a hotkey key. Pure rules: no I/O, no clock.

use std::fmt;

/// The modifier keys of a hotkey (AST-01).
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

/// Why a hotkey is refused (AST-01).
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

/// A hotkey combination the player chose, such as `Ctrl+Shift+F` (AST-01).
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
    /// Ctrl+Shift+A accepts a ready check until the player chooses another key.
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
    use super::{HotkeyChoice, HotkeyKey, HotkeyRefusal};

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
    fn a_refusal_has_the_code_the_window_uses() {
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
    fn the_default_accept_hotkey_is_ctrl_shift_a_and_parses_back() {
        let default = HotkeyChoice::default_accept();
        assert_eq!(default.to_string(), "Ctrl+Shift+A");
        assert_eq!(HotkeyChoice::parse("Ctrl+Shift+A").expect("valid"), default);
    }
}
