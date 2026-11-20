//! Assisted typing's values (FR-28, AST-01, AST-02, AST-06; ADR 010). The agent types a game name for the player and never
//! confirms: the only text it can type is a `TypableName`, built from `TypableChar`s, and a `TypableChar` is one of
//! `a`–`z`, `0`–`9` and `-`. Enter, Tab, Space, Escape, Backspace and every modifier are not representable, so no caller
//! can ask for them. Pure rules: no I/O, no clock.

use std::fmt;

/// The most characters a game name may have (AST-02).
pub const MAX_NAME_LEN: usize = 32;

/// The most digits of the run number in a game name (AST-02).
const MAX_NUMBER_DIGITS: usize = 6;

/// One character the agent may type: `a`–`z`, `0`–`9` or `-` (AST-06). The only way to make one is `new`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypableChar(char);

impl TypableChar {
    /// `Some` for a lowercase ASCII letter, an ASCII digit or `-`; `None` for everything else.
    pub fn new(character: char) -> Option<Self> {
        (character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
            .then_some(Self(character))
    }

    pub fn get(self) -> char {
        self.0
    }
}

/// Why a game name is not typed (AST-02).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameRefusal {
    Empty,
    TooLong,
    /// Not `mm`, one or more of `a`–`z` and `0`–`9`, `-`, one to six digits.
    WrongShape,
}

/// A game name that may be typed: `mm[a-z0-9]+-[0-9]{1,6}`, at most 32 characters (ADR 017, AST-02).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypableName {
    text: String,
    chars: Vec<TypableChar>,
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
        // `has_shape` admits only typable characters, so every one converts.
        let chars: Vec<TypableChar> = name.chars().filter_map(TypableChar::new).collect();
        if chars.len() != name.len() {
            return Err(NameRefusal::WrongShape);
        }
        Ok(Self {
            text: name.to_string(),
            chars,
        })
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }

    /// The characters in typing order.
    pub fn chars(&self) -> &[TypableChar] {
        &self.chars
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

/// The modifier keys of a hotkey (AST-01, AST-05).
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
    /// Enter, NumpadEnter, Tab, Space, Escape or Backspace: keys that confirm or navigate.
    ConfirmingKey,
    /// Not a letter, a digit or F1–F12, or not readable as a combination.
    UnsupportedKey,
    /// The accept and the fill hotkeys must differ.
    SameAsOther,
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
        Ok(Self { modifiers, key })
    }
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

/// Which of the two hotkeys a change is for (AST-01).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    Accept,
    Fill,
}

impl HotkeyAction {
    /// `accept` or `fill`, as the window names them.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "accept" => Some(Self::Accept),
            "fill" => Some(Self::Fill),
            _ => None,
        }
    }
}

impl HotkeyRefusal {
    /// The code the window maps to its message for this refusal.
    pub fn code(self) -> &'static str {
        match self {
            Self::NoModifier => "no-modifier",
            Self::ConfirmingKey => "confirming-key",
            Self::UnsupportedKey => "unsupported-key",
            Self::SameAsOther => "same-as-other",
        }
    }
}

/// The two hotkeys of the agent: the one that accepts a ready check (RDY-07) and the one that fills the name (AST-01).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotkeyPair {
    accept: HotkeyChoice,
    fill: HotkeyChoice,
}

impl HotkeyPair {
    /// Ctrl+Shift+A accepts, Ctrl+Shift+F fills.
    pub fn defaults() -> Self {
        let both = Modifiers {
            ctrl: true,
            shift: true,
            alt: false,
        };
        Self {
            accept: HotkeyChoice {
                modifiers: both,
                key: HotkeyKey::Letter('A'),
            },
            fill: HotkeyChoice {
                modifiers: both,
                key: HotkeyKey::Letter('F'),
            },
        }
    }

    /// The pair of these two hotkeys, or why it is refused (they must differ).
    pub fn new(accept: HotkeyChoice, fill: HotkeyChoice) -> Result<Self, HotkeyRefusal> {
        if accept == fill {
            return Err(HotkeyRefusal::SameAsOther);
        }
        Ok(Self { accept, fill })
    }

    pub fn accept(&self) -> HotkeyChoice {
        self.accept
    }

    pub fn fill(&self) -> HotkeyChoice {
        self.fill
    }

    /// The pair with a new accept hotkey, or why it is refused (it must differ from the fill hotkey).
    pub fn with_accept(&self, accept: HotkeyChoice) -> Result<Self, HotkeyRefusal> {
        if accept == self.fill {
            return Err(HotkeyRefusal::SameAsOther);
        }
        Ok(Self { accept, ..*self })
    }

    /// The pair with a new fill hotkey, or why it is refused (it must differ from the accept hotkey).
    pub fn with_fill(&self, fill: HotkeyChoice) -> Result<Self, HotkeyRefusal> {
        if fill == self.accept {
            return Err(HotkeyRefusal::SameAsOther);
        }
        Ok(Self { fill, ..*self })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        HotkeyChoice, HotkeyKey, HotkeyPair, HotkeyRefusal, MAX_NAME_LEN, NameRefusal, TypableChar,
        TypableName,
    };

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
                    let typed: String = typable.chars().iter().map(|c| c.get()).collect();
                    assert_eq!(typed, name, "the characters spell the name");
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
    fn only_lowercase_letters_digits_and_the_hyphen_are_typable_characters() {
        for typable in ('a'..='z').chain('0'..='9').chain(['-']) {
            assert_eq!(
                TypableChar::new(typable).map(TypableChar::get),
                Some(typable)
            );
        }
        for other in [
            '\n', '\r', '\t', ' ', '\u{8}', '\u{1b}', 'A', 'Z', '/', '_', '.', '@', '\u{e9}',
            '\u{0}',
        ] {
            assert!(TypableChar::new(other).is_none(), "{other:?}");
        }
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
    fn an_action_and_a_refusal_have_the_names_the_window_uses() {
        use super::HotkeyAction;
        assert_eq!(HotkeyAction::parse("accept"), Some(HotkeyAction::Accept));
        assert_eq!(HotkeyAction::parse("fill"), Some(HotkeyAction::Fill));
        for other in ["", "Fill", "confirm", "accept "] {
            assert_eq!(HotkeyAction::parse(other), None, "{other:?}");
        }
        let codes: Vec<&str> = [
            HotkeyRefusal::NoModifier,
            HotkeyRefusal::ConfirmingKey,
            HotkeyRefusal::UnsupportedKey,
            HotkeyRefusal::SameAsOther,
        ]
        .map(HotkeyRefusal::code)
        .to_vec();
        assert_eq!(
            codes,
            [
                "no-modifier",
                "confirming-key",
                "unsupported-key",
                "same-as-other"
            ]
        );
    }

    #[test]
    fn the_two_hotkeys_differ_and_a_refusal_keeps_the_pair() {
        let pair = HotkeyPair::defaults();
        assert_eq!(pair.accept().to_string(), "Ctrl+Shift+A");
        assert_eq!(pair.fill().to_string(), "Ctrl+Shift+F");
        let same_as_fill = HotkeyChoice::parse("Ctrl+Shift+F").expect("valid");
        assert_eq!(
            pair.with_accept(same_as_fill).err(),
            Some(HotkeyRefusal::SameAsOther)
        );
        let same_as_accept = HotkeyChoice::parse("ctrl+shift+a").expect("valid");
        assert_eq!(
            pair.with_fill(same_as_accept).err(),
            Some(HotkeyRefusal::SameAsOther)
        );
        assert_eq!(
            HotkeyPair::new(same_as_fill, same_as_fill).err(),
            Some(HotkeyRefusal::SameAsOther)
        );
        assert_eq!(
            HotkeyPair::new(same_as_accept, same_as_fill).expect("two keys"),
            pair
        );
        let other = HotkeyChoice::parse("Alt+G").expect("valid");
        let changed = pair.with_fill(other).expect("a different key");
        assert_eq!(changed.fill(), other);
        assert_eq!(changed.accept(), pair.accept());
    }
}
