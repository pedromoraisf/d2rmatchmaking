//! The language pack: the words the agent looks for on the screen, by key (AGN-02, AGN-08). The pack holds data only; the
//! reader asks it for a word and never names one in code, so a Portuguese pack adds words and no rule. The English pack
//! is built in; the adapters crate parses the JSON packs the app ships (the domain has no serialisation crate, ADR 027).

use std::collections::BTreeMap;

use crate::characters::{Class, Title};

/// The Party panel's title word.
pub const PARTY: &str = "party";
/// The label above the Game Name field.
pub const GAME_NAME: &str = "gameName";
/// The label above the Password field.
pub const PASSWORD: &str = "password";

/// The word of the level on a card ("Level 88 Sorceress"), CHR-06.
pub const CHARACTER_LEVEL: &str = "characterLevel";
/// The "Create New" button of the character list (the selection screen's marker, CHR-04).
pub const CREATE_NEW: &str = "createNew";
/// The label that starts the health line in game (the in-game marker, CHR-04).
pub const LIFE: &str = "life";
/// The label that starts the difficulty line of the automap's area block (the automap's marker, CHR-04).
pub const DIFFICULTY_LABEL: &str = "difficultyLabel";
/// The title of the difficulty popup (CHR-18).
pub const SELECT_DIFFICULTY: &str = "selectDifficulty";
/// The popup's three difficulty buttons (CHR-18).
pub const DIFFICULTY_NORMAL: &str = "difficultyNormal";
pub const DIFFICULTY_NIGHTMARE: &str = "difficultyNightmare";
pub const DIFFICULTY_HELL: &str = "difficultyHell";

/// The keys a pack must hold for the Party reading. A pack without one of them is refused.
pub const REQUIRED_KEYS: [&str; 3] = [PARTY, GAME_NAME, PASSWORD];

/// The English words, the built-in pack (AGN-08 names the English strings as the source). The character keys are read
/// by the character screens; a pack lacking one of them reads no card that needs it.
const ENGLISH: &[(&str, &str)] = &[
    (PARTY, "Party"),
    (GAME_NAME, "Game Name"),
    (PASSWORD, "Password"),
    (CHARACTER_LEVEL, "Level"),
    ("classAmazon", "Amazon"),
    ("classAssassin", "Assassin"),
    ("classBarbarian", "Barbarian"),
    ("classDruid", "Druid"),
    ("classNecromancer", "Necromancer"),
    ("classPaladin", "Paladin"),
    ("classSorceress", "Sorceress"),
    ("classWarlock", "Warlock"),
    ("titleSir", "Sir"),
    ("titleDame", "Dame"),
    ("titleLord", "Lord"),
    ("titleLady", "Lady"),
    ("titleBaron", "Baron"),
    ("titleBaroness", "Baroness"),
    ("titleCount", "Count"),
    ("titleCountess", "Countess"),
    ("titleDuke", "Duke"),
    ("titleDuchess", "Duchess"),
    ("titleKing", "King"),
    ("titleQueen", "Queen"),
    ("titleSlayer", "Slayer"),
    ("titleChampion", "Champion"),
    ("titlePatriarch", "Patriarch"),
    ("titleMatriarch", "Matriarch"),
    ("titleDestroyer", "Destroyer"),
    ("titleConqueror", "Conqueror"),
    ("titleGuardian", "Guardian"),
    (CREATE_NEW, "Create New"),
    (LIFE, "Life:"),
    (DIFFICULTY_LABEL, "Difficulty:"),
    (SELECT_DIFFICULTY, "Select Difficulty"),
    (DIFFICULTY_NORMAL, "Normal"),
    (DIFFICULTY_NIGHTMARE, "Nightmare"),
    (DIFFICULTY_HELL, "Hell"),
];

/// The pack key of a class name.
pub fn class_key(class: Class) -> &'static str {
    match class {
        Class::Amazon => "classAmazon",
        Class::Assassin => "classAssassin",
        Class::Barbarian => "classBarbarian",
        Class::Druid => "classDruid",
        Class::Necromancer => "classNecromancer",
        Class::Paladin => "classPaladin",
        Class::Sorceress => "classSorceress",
        Class::Warlock => "classWarlock",
    }
}

/// The pack key of a title.
pub fn title_key(title: Title) -> &'static str {
    match title {
        Title::Sir => "titleSir",
        Title::Dame => "titleDame",
        Title::Lord => "titleLord",
        Title::Lady => "titleLady",
        Title::Baron => "titleBaron",
        Title::Baroness => "titleBaroness",
        Title::Count => "titleCount",
        Title::Countess => "titleCountess",
        Title::Duke => "titleDuke",
        Title::Duchess => "titleDuchess",
        Title::King => "titleKing",
        Title::Queen => "titleQueen",
        Title::Slayer => "titleSlayer",
        Title::Champion => "titleChampion",
        Title::Patriarch => "titlePatriarch",
        Title::Matriarch => "titleMatriarch",
        Title::Destroyer => "titleDestroyer",
        Title::Conqueror => "titleConqueror",
        Title::Guardian => "titleGuardian",
    }
}

/// A language's words by key, with the tag that names the language (`en`, `pt-BR`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanguagePack {
    tag: String,
    words: BTreeMap<String, String>,
}

/// Why a pack is refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PackError {
    #[error("the pack has no language tag")]
    NoTag,
    #[error("the pack has no word for the key {0}")]
    MissingWord(&'static str),
    #[error("the pack has an empty word for the key {0}")]
    EmptyWord(String),
}

impl LanguagePack {
    /// The built-in English pack.
    pub fn english() -> Self {
        Self {
            tag: "en".to_string(),
            words: ENGLISH
                .iter()
                .map(|(key, word)| ((*key).to_string(), (*word).to_string()))
                .collect(),
        }
    }

    /// A pack from its tag and its words. The tag must not be empty; every required key must hold a word, and no word may be
    /// empty after trimming. Keys beyond the required ones are kept as given.
    pub fn from_words(
        tag: impl Into<String>,
        words: impl IntoIterator<Item = (String, String)>,
    ) -> Result<Self, PackError> {
        let tag = tag.into();
        if tag.trim().is_empty() {
            return Err(PackError::NoTag);
        }
        let words: BTreeMap<String, String> = words.into_iter().collect();
        for key in REQUIRED_KEYS {
            match words.get(key) {
                None => return Err(PackError::MissingWord(key)),
                Some(word) if word.trim().is_empty() => {
                    return Err(PackError::EmptyWord(key.to_string()));
                }
                Some(_) => {}
            }
        }
        Ok(Self { tag, words })
    }

    /// The language tag the pack was made for.
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// The word of `key`, or `None` when the pack holds none.
    pub fn word(&self, key: &str) -> Option<&str> {
        self.words.get(key).map(String::as_str)
    }

    /// Whether `text`, as the reader read it from the screen, is the word of `key`. `false` for a key the pack lacks.
    pub fn is_word(&self, text: &str, key: &str) -> bool {
        self.word(key).is_some_and(|word| same_label(text, word))
    }

    /// Whether `text` starts with the word of `key` (a label followed by its value, such as "Life: 925 / 925").
    pub fn begins_with(&self, text: &str, key: &str) -> bool {
        self.word(key)
            .is_some_and(|word| label_key(text).starts_with(&label_key(word)))
    }
}

/// Whether a text read from a label is the word it names. The comparison trims, collapses runs of whitespace, ignores case
/// and diacritics (CHR-08), and reads the glyphs D2R draws for the letter O (`⊕`, `Ø`) and for zero as `o`, since OCR cannot
/// tell them apart in a label (ADR 017, the screenshots of 2026-11-10).
pub fn same_label(read: &str, word: &str) -> bool {
    label_key(read) == label_key(word)
}

fn label_key(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '0' | 'ø' | '⊕' => 'o',
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{GAME_NAME, LanguagePack, PARTY, PASSWORD, PackError, same_label};

    fn words(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(key, word)| ((*key).to_string(), (*word).to_string()))
            .collect()
    }

    #[test]
    fn english_is_built_in_with_the_three_labels() {
        let english = LanguagePack::english();
        assert_eq!(english.tag(), "en");
        assert_eq!(english.word(PARTY), Some("Party"));
        assert_eq!(english.word(GAME_NAME), Some("Game Name"));
        assert_eq!(english.word(PASSWORD), Some("Password"));
        assert_eq!(
            english.word("level"),
            None,
            "a key the pack lacks has no word"
        );
    }

    #[test]
    fn a_pack_needs_a_tag() {
        let all = words(&[
            (PARTY, "Party"),
            (GAME_NAME, "Game Name"),
            (PASSWORD, "Password"),
        ]);
        assert_eq!(LanguagePack::from_words("  ", all), Err(PackError::NoTag));
    }

    #[test]
    fn a_pack_needs_every_required_key() {
        let without_password = words(&[(PARTY, "Party"), (GAME_NAME, "Game Name")]);
        assert_eq!(
            LanguagePack::from_words("en", without_password),
            Err(PackError::MissingWord(PASSWORD))
        );
    }

    #[test]
    fn a_required_word_is_not_empty() {
        let blank = words(&[(PARTY, "Party"), (GAME_NAME, "  "), (PASSWORD, "Password")]);
        assert_eq!(
            LanguagePack::from_words("en", blank),
            Err(PackError::EmptyWord(GAME_NAME.to_string()))
        );
    }

    #[test]
    fn extra_keys_are_kept_for_later_readings() {
        let extended = words(&[
            (PARTY, "Party"),
            (GAME_NAME, "Game Name"),
            (PASSWORD, "Password"),
            ("level", "Level"),
        ]);
        let pack = LanguagePack::from_words("en", extended).expect("the pack builds");
        assert_eq!(pack.word("level"), Some("Level"));
    }

    #[test]
    fn a_label_matches_its_word_without_case_or_extra_spaces() {
        assert!(same_label("Game Name", "Game Name"));
        assert!(same_label("GAME NAME", "Game Name"));
        assert!(same_label("  game   name ", "Game Name"));
        assert!(!same_label("Game", "Game Name"));
        assert!(!same_label("Password", "Game Name"));
    }

    #[test]
    fn the_glyphs_of_the_letter_o_and_zero_match_each_other() {
        assert!(
            same_label("PASSWØRD", "Password"),
            "a slashed zero in the word"
        );
        assert!(same_label("PASSW⊕RD", "Password"), "the O drawn as ⊕");
        assert!(same_label("PASSW0RD", "Password"), "a zero read by OCR");
        assert!(
            !same_label("P⊕RTY", "Party"),
            "a different word stays different"
        );
    }

    #[test]
    fn is_word_asks_the_pack_for_its_key() {
        let english = LanguagePack::english();
        assert!(english.is_word("PARTY", PARTY));
        assert!(!english.is_word("PARTY", PASSWORD));
        assert!(
            !english.is_word("Party", "level"),
            "a missing key matches nothing"
        );
    }
}
