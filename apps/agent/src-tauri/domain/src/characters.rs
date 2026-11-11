//! The character cards of the character selection screen (CHR-06) and the difficulties each title unlocks (CHR-07). The
//! reader (core, and the OCR of the app crate) hands in the text it read; a card is built only when every field was read
//! and passes its rule, so a half-read character never reaches the API. No I/O, no clock, no randomness.

use thiserror::Error;

/// Softcore or hardcore, as the game shows the mode (glossary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Softcore,
    Hardcore,
}

/// The eight classes of D2R (glossary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Amazon,
    Assassin,
    Barbarian,
    Druid,
    Necromancer,
    Paladin,
    Sorceress,
    Warlock,
}

/// A difficulty a character may enter (glossary).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Difficulty {
    Normal,
    Nightmare,
    Hell,
}

/// The rank a title gives: the Normal title unlocks Nightmare, the Nightmare and Hell titles unlock Hell (CHR-07).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tier {
    Normal,
    Nightmare,
    Hell,
}

/// The titles of the character selection screen, by their English names (CHR-07). Each title has one name per gender.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Title {
    // Classic softcore.
    Sir,
    Dame,
    Lord,
    Lady,
    Baron,
    Baroness,
    // Classic hardcore.
    Count,
    Countess,
    Duke,
    Duchess,
    King,
    Queen,
    // Expansion softcore.
    Slayer,
    Champion,
    Patriarch,
    Matriarch,
    // Expansion hardcore.
    Destroyer,
    Conqueror,
    Guardian,
}

impl Title {
    /// Every title, in the order of the table of CHR-07.
    pub const ALL: [Title; 19] = [
        Title::Sir,
        Title::Dame,
        Title::Lord,
        Title::Lady,
        Title::Baron,
        Title::Baroness,
        Title::Count,
        Title::Countess,
        Title::Duke,
        Title::Duchess,
        Title::King,
        Title::Queen,
        Title::Slayer,
        Title::Champion,
        Title::Patriarch,
        Title::Matriarch,
        Title::Destroyer,
        Title::Conqueror,
        Title::Guardian,
    ];

    /// The title's English name, as the game shows it.
    pub fn english_name(self) -> &'static str {
        match self {
            Title::Sir => "Sir",
            Title::Dame => "Dame",
            Title::Lord => "Lord",
            Title::Lady => "Lady",
            Title::Baron => "Baron",
            Title::Baroness => "Baroness",
            Title::Count => "Count",
            Title::Countess => "Countess",
            Title::Duke => "Duke",
            Title::Duchess => "Duchess",
            Title::King => "King",
            Title::Queen => "Queen",
            Title::Slayer => "Slayer",
            Title::Champion => "Champion",
            Title::Patriarch => "Patriarch",
            Title::Matriarch => "Matriarch",
            Title::Destroyer => "Destroyer",
            Title::Conqueror => "Conqueror",
            Title::Guardian => "Guardian",
        }
    }

    /// The title with this English name, or none for any other text.
    pub fn from_english_name(name: &str) -> Option<Title> {
        Title::ALL
            .into_iter()
            .find(|title| title.english_name() == name)
    }

    /// The mode whose ladder the title belongs to: the classic and expansion, softcore and hardcore columns of CHR-07.
    pub fn mode(self) -> Mode {
        match self {
            Title::Sir
            | Title::Dame
            | Title::Lord
            | Title::Lady
            | Title::Baron
            | Title::Baroness
            | Title::Slayer
            | Title::Champion
            | Title::Patriarch
            | Title::Matriarch => Mode::Softcore,
            Title::Count
            | Title::Countess
            | Title::Duke
            | Title::Duchess
            | Title::King
            | Title::Queen
            | Title::Destroyer
            | Title::Conqueror
            | Title::Guardian => Mode::Hardcore,
        }
    }

    fn tier(self) -> Tier {
        match self {
            Title::Sir
            | Title::Dame
            | Title::Count
            | Title::Countess
            | Title::Slayer
            | Title::Destroyer => Tier::Normal,
            Title::Lord
            | Title::Lady
            | Title::Duke
            | Title::Duchess
            | Title::Champion
            | Title::Conqueror => Tier::Nightmare,
            Title::Baron
            | Title::Baroness
            | Title::King
            | Title::Queen
            | Title::Patriarch
            | Title::Matriarch
            | Title::Guardian => Tier::Hell,
        }
    }
}

/// The difficulties a character unlocks (CHR-07). No title unlocks Normal only; the Normal title adds Nightmare; the
/// Nightmare and Hell titles add Hell. A title and its mode are read from the card together, and the mode is not
/// changed by the title.
pub fn unlocked_difficulties(title: Option<Title>) -> Vec<Difficulty> {
    match title.map(Title::tier) {
        None => vec![Difficulty::Normal],
        Some(Tier::Normal) => vec![Difficulty::Normal, Difficulty::Nightmare],
        Some(Tier::Nightmare | Tier::Hell) => {
            vec![Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell]
        }
    }
}

/// Why a card was refused: the field that broke its rule.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CardError {
    #[error("the name is not 2 to 15 letters, with at most one inner - or _")]
    InvalidName,
    #[error("the level is outside 1 to 99")]
    LevelOutOfRange,
    #[error("the title belongs to the other mode")]
    TitleOfOtherMode,
}

/// A character as the screen shows it, with every field read and every rule met.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Card {
    name: String,
    class: Class,
    level: u8,
    mode: Mode,
    title: Option<Title>,
}

const NAME_MIN: usize = 2;
const NAME_MAX: usize = 15;
const LEVEL_MIN: u8 = 1;
const LEVEL_MAX: u8 = 99;

/// The name rule of D2R (CHR-10): 2 to 15 letters, with at most one `-` or `_` that is neither first nor last.
pub fn is_character_name(name: &str) -> bool {
    let length = name.chars().count();
    if !(NAME_MIN..=NAME_MAX).contains(&length) {
        return false;
    }
    let mut separators = 0_usize;
    let mut previous_was_separator = true;
    for (index, character) in name.chars().enumerate() {
        if character.is_ascii_alphabetic() {
            previous_was_separator = false;
        } else if character == '-' || character == '_' {
            separators += 1;
            if index == 0 || previous_was_separator || separators > 1 {
                return false;
            }
            previous_was_separator = true;
        } else {
            return false;
        }
    }
    !previous_was_separator
}

impl Card {
    /// Builds a card from fields that were all read. A refused field is named by its error and the card is not built.
    pub fn new(
        name: &str,
        class: Class,
        level: u8,
        mode: Mode,
        title: Option<Title>,
    ) -> Result<Card, CardError> {
        if !is_character_name(name) {
            return Err(CardError::InvalidName);
        }
        if !(LEVEL_MIN..=LEVEL_MAX).contains(&level) {
            return Err(CardError::LevelOutOfRange);
        }
        if title.is_some_and(|title| title.mode() != mode) {
            return Err(CardError::TitleOfOtherMode);
        }
        Ok(Card {
            name: name.to_owned(),
            class,
            level,
            mode,
            title,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn class(&self) -> Class {
        self.class
    }

    pub fn level(&self) -> u8 {
        self.level
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    pub fn title(&self) -> Option<Title> {
        self.title
    }

    /// The difficulties this card's title unlocks (CHR-07).
    pub fn unlocked_difficulties(&self) -> Vec<Difficulty> {
        unlocked_difficulties(self.title)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Card, CardError, Class, Difficulty, Mode, Title, is_character_name, unlocked_difficulties,
    };

    use Difficulty::{Hell, Nightmare, Normal};

    /// Every title with its mode and its unlocked difficulties, as the table of CHR-07 gives them.
    const TABLE: [(Title, &str, Mode, &[Difficulty]); 19] = [
        (Title::Sir, "Sir", Mode::Softcore, &[Normal, Nightmare]),
        (Title::Dame, "Dame", Mode::Softcore, &[Normal, Nightmare]),
        (
            Title::Lord,
            "Lord",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Lady,
            "Lady",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Baron,
            "Baron",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Baroness,
            "Baroness",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (Title::Count, "Count", Mode::Hardcore, &[Normal, Nightmare]),
        (
            Title::Countess,
            "Countess",
            Mode::Hardcore,
            &[Normal, Nightmare],
        ),
        (
            Title::Duke,
            "Duke",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Duchess,
            "Duchess",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::King,
            "King",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Queen,
            "Queen",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Slayer,
            "Slayer",
            Mode::Softcore,
            &[Normal, Nightmare],
        ),
        (
            Title::Champion,
            "Champion",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Patriarch,
            "Patriarch",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Matriarch,
            "Matriarch",
            Mode::Softcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Destroyer,
            "Destroyer",
            Mode::Hardcore,
            &[Normal, Nightmare],
        ),
        (
            Title::Conqueror,
            "Conqueror",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
        (
            Title::Guardian,
            "Guardian",
            Mode::Hardcore,
            &[Normal, Nightmare, Hell],
        ),
    ];

    #[test]
    fn every_title_has_its_english_name_mode_and_unlocks() {
        for (title, name, mode, unlocked) in TABLE {
            assert_eq!(title.english_name(), name, "{title:?}");
            assert_eq!(title.mode(), mode, "{title:?}");
            assert_eq!(unlocked_difficulties(Some(title)), unlocked, "{title:?}");
        }
    }

    #[test]
    fn the_table_covers_every_title_once() {
        assert_eq!(Title::ALL.len(), TABLE.len());
        for title in Title::ALL {
            assert!(
                TABLE.iter().any(|(listed, ..)| *listed == title),
                "{title:?}"
            );
        }
    }

    #[test]
    fn a_name_of_a_title_is_read_back_to_the_title() {
        for (title, name, ..) in TABLE {
            assert_eq!(Title::from_english_name(name), Some(title));
        }
        assert_eq!(Title::from_english_name("Sirr"), None);
        assert_eq!(Title::from_english_name(""), None);
    }

    #[test]
    fn no_title_unlocks_normal_only() {
        assert_eq!(unlocked_difficulties(None), vec![Normal]);
    }

    #[test]
    fn the_normal_title_unlocks_nightmare() {
        assert_eq!(
            unlocked_difficulties(Some(Title::Sir)),
            vec![Normal, Nightmare]
        );
    }

    #[test]
    fn the_nightmare_and_hell_titles_unlock_hell() {
        assert_eq!(
            unlocked_difficulties(Some(Title::Lord)),
            vec![Normal, Nightmare, Hell]
        );
        assert_eq!(
            unlocked_difficulties(Some(Title::Baron)),
            vec![Normal, Nightmare, Hell]
        );
    }

    #[test]
    fn name_rule_accepts_two_to_fifteen_letters_with_one_inner_separator() {
        for name in ["Sorc", "Zo", "Mad-Man", "Mad_Man", "AAAAAAAAAAAAAAA"] {
            assert!(is_character_name(name), "{name}");
        }
    }

    #[test]
    fn name_rule_refuses_each_breach() {
        for name in [
            "A",
            "AAAAAAAAAAAAAAAA",
            "",
            "a name",
            "Sorc2",
            "-Sorc",
            "Sorc-",
            "So-r_c",
            "So--rc",
            "Sor\u{e7}",
        ] {
            assert!(!is_character_name(name), "{name}");
        }
    }

    fn card(name: &str, level: u8, mode: Mode, title: Option<Title>) -> Result<Card, CardError> {
        Card::new(name, Class::Sorceress, level, mode, title)
    }

    #[test]
    fn a_card_is_built_from_read_fields_and_exposes_its_unlocks() {
        let built = card("Sorc", 85, Mode::Softcore, Some(Title::Lord)).expect("the card builds");
        assert_eq!(built.name(), "Sorc");
        assert_eq!(built.level(), 85);
        assert_eq!(built.unlocked_difficulties(), vec![Normal, Nightmare, Hell]);
    }

    #[test]
    fn level_bounds_are_one_and_ninety_nine() {
        assert!(card("Sorc", 1, Mode::Softcore, None).is_ok());
        assert!(card("Sorc", 99, Mode::Softcore, None).is_ok());
        assert_eq!(
            card("Sorc", 0, Mode::Softcore, None),
            Err(CardError::LevelOutOfRange)
        );
        assert_eq!(
            card("Sorc", 100, Mode::Softcore, None),
            Err(CardError::LevelOutOfRange)
        );
    }

    #[test]
    fn a_card_with_a_breaking_name_is_refused() {
        assert_eq!(
            card("a name", 85, Mode::Softcore, None),
            Err(CardError::InvalidName)
        );
    }

    #[test]
    fn a_title_of_the_other_mode_is_refused() {
        assert_eq!(
            card("Sorc", 85, Mode::Softcore, Some(Title::Count)),
            Err(CardError::TitleOfOtherMode)
        );
        assert!(card("Sorc", 85, Mode::Hardcore, Some(Title::Count)).is_ok());
    }
}
