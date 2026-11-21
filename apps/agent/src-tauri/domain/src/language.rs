//! The language pack: the words the agent looks for on the screen, by key (AGN-02, AGN-08). The pack holds data only; the
//! reader asks it for a word and never names one in code, so a Portuguese pack adds words and no rule. The English pack
//! is built in; the adapters crate parses the JSON packs the app ships (the domain has no serialisation crate, ADR 027).

use std::collections::BTreeMap;

use crate::characters::{Class, Difficulty, Title};
use crate::remote_config::Phrases;
use crate::vocabulary::{edit_distance, nearest, squash, threshold};

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
/// The label that starts the mana line in game, the other word of the in-game HUD (searched with `LIFE`).
pub const MANA: &str = "mana";
/// The label that starts the difficulty line of the automap's area block (the automap's marker, CHR-04).
pub const DIFFICULTY_LABEL: &str = "difficultyLabel";
/// The title of the difficulty popup (CHR-18).
pub const SELECT_DIFFICULTY: &str = "selectDifficulty";
/// The popup's three difficulty buttons (CHR-18).
pub const DIFFICULTY_NORMAL: &str = "difficultyNormal";
pub const DIFFICULTY_NIGHTMARE: &str = "difficultyNightmare";
pub const DIFFICULTY_HELL: &str = "difficultyHell";
/// The ONLINE / OFFLINE tabs over the character list: the strip is never a card line.
pub const TAB_ONLINE: &str = "tabOnline";
pub const TAB_OFFLINE: &str = "tabOffline";

/// The fixed phrase of the chat line that says a player joined the game ("<name> joined our world"), GNR-07. Measured on the
/// maintainer's chat prints by `ocr-real` (English; the Portuguese phrases are in `resources/lang/pt-BR.json`).
pub const JOINED_GAME: &str = "joinedGame";
/// The fixed phrase of the chat line that says a player left the game ("<name> left our world"), GNR-07.
pub const LEFT_GAME: &str = "leftGame";

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
    (MANA, "Mana:"),
    (DIFFICULTY_LABEL, "Difficulty:"),
    (SELECT_DIFFICULTY, "Select Difficulty"),
    (DIFFICULTY_NORMAL, "Normal"),
    (DIFFICULTY_NIGHTMARE, "Nightmare"),
    (DIFFICULTY_HELL, "Hell"),
    (TAB_ONLINE, "Online"),
    (TAB_OFFLINE, "Offline"),
    (JOINED_GAME, "joined our world"),
    (LEFT_GAME, "left our world"),
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
    /// Another language's pack, tried by the Party step when this one finds no panel (`with_fallback`).
    fallback: Option<Box<LanguagePack>>,
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
            fallback: None,
        }
    }

    /// This pack with `fallback` as the pack the Party step tries when this one's words find no panel (screen-recognition T6,
    /// SCR-04: the maintainer plays on a pt-BR client, whose panel the English words never find). The fallback's words come
    /// from its file (`resources/lang/pt-BR.json`), not from code; only the Party anchors are read with them, and the game
    /// name is matched as ever.
    #[must_use]
    pub fn with_fallback(mut self, fallback: LanguagePack) -> Self {
        self.fallback = Some(Box::new(fallback));
        self
    }

    /// The pack tried when this one finds no Party panel, if any.
    pub fn fallback(&self) -> Option<&LanguagePack> {
        self.fallback.as_deref()
    }

    /// This pack with the Party words of the remote configuration (`phrases.<tag>.party`, `gameName`, `password`): the words
    /// of the language whose tag the pack has replace the pack's, key by key, and a word that is absent or blank stays what
    /// the pack holds. The fallback pack is treated the same with its own tag. Only these three keys can change, every other
    /// word is untouched, and each configured word is a literal compared by the pack's own rules, never a pattern (RCF-05,
    /// RCF-10). A pack of a tag the configuration does not name is returned as it is.
    #[must_use]
    pub fn with_phrases(&self, phrases: &Phrases) -> Self {
        let words = match self.tag.as_str() {
            "en" => Some(&phrases.en),
            "pt-BR" => Some(&phrases.pt_br),
            _ => None,
        };
        let mut pack = self.clone();
        if let Some(words) = words {
            for (key, word) in [
                (PARTY, &words.party),
                (GAME_NAME, &words.game_name),
                (PASSWORD, &words.password),
            ] {
                if let Some(word) = word.as_deref().filter(|word| !word.trim().is_empty()) {
                    pack.words.insert(key.to_string(), word.to_string());
                }
            }
        }
        pack.fallback = self
            .fallback
            .as_deref()
            .map(|fallback| Box::new(fallback.with_phrases(phrases)));
        pack
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
        Ok(Self {
            tag,
            words,
            fallback: None,
        })
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

    /// Whether `text` is the word of `key` once case, diacritics and all whitespace are ignored. D2R draws its labels in
    /// small caps, and OCR returns them as mixed case with stray spaces ("GA m E N A me" for "Game Name"). `false` for a
    /// key the pack lacks.
    pub fn is_squashed_word(&self, text: &str, key: &str) -> bool {
        self.word(key)
            .is_some_and(|word| squashed_key(text) == squashed_key(word))
    }

    /// Whether the Party panel is open, from the text read at its title: the pack's title or a prefix of it of at least
    /// `MIN_TITLE_PREFIX` letters (a tooltip over the title leaves "PAR"). The one rule of the agent and of `ocr-check`;
    /// the word comes from the pack.
    pub fn party_panel_open(&self, title: &str) -> bool {
        self.is_title_prefix(title, PARTY)
    }

    /// Whether `text` is the word of `key` or a prefix of it at least `MIN_TITLE_PREFIX` letters long.
    pub fn is_title_prefix(&self, text: &str, key: &str) -> bool {
        let read = squashed_key(text);
        self.word(key).is_some_and(|word| {
            read.chars().count() >= MIN_TITLE_PREFIX && squashed_key(word).starts_with(&read)
        })
    }

    /// The class a noisy read of a class word names: the pack's nearest class word, or `None` when none is the single nearest.
    pub fn read_class(&self, text: &str) -> Option<Class> {
        let words: Vec<(Class, &str)> = Class::ALL
            .into_iter()
            .filter_map(|class| Some((class, self.word(class_key(class))?)))
            .collect();
        nearest(text, &words)
    }

    /// The title a noisy read of a title word names (see `read_class`).
    pub fn read_title_word(&self, text: &str) -> Option<Title> {
        let words: Vec<(Title, &str)> = Title::ALL
            .into_iter()
            .filter_map(|title| Some((title, self.word(title_key(title))?)))
            .collect();
        nearest(text, &words)
    }

    /// The difficulty a noisy read of a popup label names (see `read_class`).
    pub fn read_difficulty(&self, text: &str) -> Option<Difficulty> {
        let words: Vec<(Difficulty, &str)> = [
            (Difficulty::Normal, DIFFICULTY_NORMAL),
            (Difficulty::Nightmare, DIFFICULTY_NIGHTMARE),
            (Difficulty::Hell, DIFFICULTY_HELL),
        ]
        .into_iter()
        .filter_map(|(difficulty, key)| Some((difficulty, self.word(key)?)))
        .collect();
        nearest(text, &words)
    }

    /// Whether a noisy read is the pack's "Level" word.
    pub fn is_level_word(&self, text: &str) -> bool {
        self.word(CHARACTER_LEVEL)
            .is_some_and(|word| nearest(text, &[((), word)]).is_some())
    }

    /// Whether a noisy read is, or is within the vocabulary threshold of, the word of `key` (digits and punctuation dropped,
    /// so "PA55WORD" is near "Password"). Used to keep a garbled label from being taken for a value; `false` for a key the
    /// pack lacks.
    pub fn is_near_word(&self, text: &str, key: &str) -> bool {
        self.is_squashed_word(text, key)
            || self
                .word(key)
                .is_some_and(|word| nearest(text, &[((), word)]).is_some())
    }

    /// Whether a line of the Party panel is the label of `key`: the word, or a noisy read of it (spaces, case and stray
    /// punctuation dropped, `RN` read for `M`, within the vocabulary threshold; `is_near_word`), and not also near any of the
    /// `others` (the panel's other words): a line that reads as both is not a label.
    pub fn is_label(&self, text: &str, key: &str, others: &[&str]) -> bool {
        self.is_near_word(text, key) && !others.iter().any(|other| self.is_near_word(text, other))
    }

    /// Whether `text` starts with the word of `key` (a label followed by its value, such as "Life: 925 / 925"). The start
    /// may be misread within the vocabulary threshold ("Lite:" for "Life:", characters-reading T21).
    pub fn begins_with(&self, text: &str, key: &str) -> bool {
        self.word(key).is_some_and(|word| {
            if label_key(text).starts_with(&label_key(word)) {
                return true;
            }
            let word = squash(word);
            let length = word.chars().count();
            let start: String = squash(text).chars().take(length).collect();
            start.chars().count() == length && edit_distance(&start, &word) <= threshold(length)
        })
    }
}

/// Whether a text read from a label is the word it names. The comparison trims, collapses runs of whitespace, ignores case
/// and diacritics (CHR-08), and reads the glyphs D2R draws for the letter O (`⊕`, `Ø`) and for zero as `o`, since OCR cannot
/// tell them apart in a label (ADR 017, the screenshots of 2026-11-10).
pub fn same_label(read: &str, word: &str) -> bool {
    label_key(read) == label_key(word)
}

/// The fewest letters of a title that count as the title when the rest is covered.
pub const MIN_TITLE_PREFIX: usize = 3;

/// `label_key` with every whitespace removed, so "GA m E N A me" and "Game Name" have the same key.
fn squashed_key(text: &str) -> String {
    label_key(text)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
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
    use super::{
        GAME_NAME, JOINED_GAME, LEFT_GAME, LanguagePack, PARTY, PASSWORD, PackError, same_label,
    };
    use crate::characters::{Class, Difficulty, Title};
    use crate::remote_config::Phrases;

    fn words(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(key, word)| ((*key).to_string(), (*word).to_string()))
            .collect()
    }

    /// The words of `resources/lang/pt-BR.json` (the app crate's test pins the file to these).
    fn brazilian() -> LanguagePack {
        LanguagePack::from_words(
            "pt-BR",
            words(&[(PARTY, "Grupo"), (GAME_NAME, "Nome"), (PASSWORD, "Senha")]),
        )
        .expect("the pack builds")
    }

    #[test]
    fn a_pack_keeps_the_fallback_it_is_given_and_has_none_otherwise() {
        let english = LanguagePack::english();
        assert_eq!(english.fallback(), None);
        let with = english.with_fallback(brazilian());
        assert_eq!(with.tag(), "en", "the pack itself is unchanged");
        assert_eq!(with.fallback().map(LanguagePack::tag), Some("pt-BR"));
        assert_eq!(with.fallback().and_then(|pt| pt.fallback()), None);
        assert_eq!(with.word(PARTY), Some("Party"));
    }

    #[test]
    fn the_english_pack_holds_the_in_game_hud_words_and_the_party_words_unchanged() {
        // Pin added for rule 14 (the MANA word of f42623b9 and the Brazilian pack of 0a2d82c4 changed this file without one):
        // the HUD's two labels start their lines, and the English Party words are the ones the 1033 prints read.
        let en = LanguagePack::english();
        assert_eq!(en.word("life"), Some("Life:"));
        assert_eq!(en.word("mana"), Some("Mana:"));
        assert!(en.begins_with("Life: 925 / 925", "life"));
        assert!(en.begins_with("Mana: 120 / 120", "mana"));
        assert!(!en.begins_with("Life: 925 / 925", "mana"));
        assert_eq!(en.word(PARTY), Some("Party"));
        assert_eq!(en.word(GAME_NAME), Some("Game Name"));
        assert_eq!(en.word(PASSWORD), Some("Password"));
        assert_eq!(en.tag(), "en");
    }

    /// ocr-protection (remote-config T23, rule 14): the chat phrases of the English pack, measured by `ocr-real` on the
    /// maintainer's chat prints, before `phrases.<lang>.joinedGame` and `leftGame` can replace them.
    #[test]
    fn the_english_pack_holds_the_two_measured_chat_phrases() {
        let en = LanguagePack::english();
        assert_eq!(en.word(JOINED_GAME), Some("joined our world"));
        assert_eq!(en.word(LEFT_GAME), Some("left our world"));
        let configured = en.with_phrases(&Phrases::default());
        assert_eq!(configured.word(JOINED_GAME), Some("joined our world"));
        assert_eq!(configured.word(LEFT_GAME), Some("left our world"));
    }

    #[test]
    fn the_brazilian_party_words_read_the_measured_noisy_forms_and_not_the_english_ones() {
        // The reads are those of the six 1920x1045 prints (the `ocr-real` wide-pass diagnostics).
        let pt = brazilian();
        let en = LanguagePack::english();
        assert_eq!(pt.tag(), "pt-BR");
        assert!(pt.party_panel_open("GRUPO"));
        assert!(!pt.party_panel_open("PARTY"));
        assert!(!en.party_panel_open("GRUPO"));
        for read in ["Nome", "Neme"] {
            assert!(pt.is_label(read, GAME_NAME, &[PASSWORD]), "{read}");
        }
        for read in ["SENHA", "SEN H A", "SENKA"] {
            assert!(pt.is_near_word(read, PASSWORD), "{read}");
            assert!(!pt.is_label(read, GAME_NAME, &[PASSWORD]), "{read}");
        }
        assert!(!pt.is_label("GAME NAME", GAME_NAME, &[PASSWORD]));
    }

    #[test]
    fn the_brazilian_party_pack_holds_the_three_measured_words_and_nothing_the_panel_reads_besides()
    {
        // Pin before the words move to `resources/lang/pt-BR.json` (rule 14): the tag, the three words of the Party panel
        // and their order of lookup. The Party anchors read no other key (`find_party`), so only these three matter.
        let pt = brazilian();
        assert_eq!(pt.tag(), "pt-BR");
        assert_eq!(pt.word(PARTY), Some("Grupo"));
        assert_eq!(pt.word(GAME_NAME), Some("Nome"));
        assert_eq!(pt.word(PASSWORD), Some("Senha"));
        assert!(pt.is_title_prefix("GRU", PARTY), "a tooltip over the title");
        assert!(
            !pt.is_title_prefix("GR", PARTY),
            "two letters are not enough"
        );
        assert!(pt.is_squashed_word("S E N H A", PASSWORD));
        assert!(pt.is_squashed_word("nome", GAME_NAME));
    }

    #[test]
    fn a_label_followed_by_its_value_is_found_even_when_its_start_is_misread() {
        let pack = LanguagePack::english();
        assert!(pack.begins_with("Life: 925 / 925", "life"));
        assert!(pack.begins_with("Lite:", "life"), "the real read of Life:");
        assert!(pack.begins_with("Difficulty: Hell", "difficultyLabel"));
        assert!(pack.begins_with("Diffrculty: Hell", "difficultyLabel"));
        assert!(!pack.begins_with("Mana: 90", "life"));
        assert!(!pack.begins_with("Li", "life"));
        assert!(!pack.begins_with("", "life"));
    }

    /// The Party panel as the maintainer's Windows OCR returned it (2026-11-11).
    #[test]
    fn small_caps_label_read_with_stray_spaces_is_the_game_name_label() {
        let english = LanguagePack::english();
        assert!(english.is_squashed_word("GA m E N A me", GAME_NAME));
        assert!(!english.is_squashed_word("PASSWORD", GAME_NAME));
        assert!(!english.is_squashed_word("", GAME_NAME));
        assert!(!english.is_squashed_word("GAME", "missing-key"));
    }

    #[test]
    fn the_panel_is_open_when_the_title_or_three_letters_of_it_read() {
        let english = LanguagePack::english();
        assert!(english.party_panel_open("PARTY"), "the title");
        assert!(english.party_panel_open("PAR"), "a tooltip over the title");
        assert!(!english.party_panel_open("PA"), "2 letters are not enough");
        assert!(!english.party_panel_open("PARTYS"), "not a prefix");
        assert!(!english.party_panel_open(""), "nothing read");
        assert!(!english.party_panel_open("Life: 9"), "another screen");
    }

    #[test]
    fn the_real_reads_find_their_class_title_difficulty_and_level_word() {
        let english = LanguagePack::english();
        assert_eq!(english.read_class("SBRCERESS"), Some(Class::Sorceress));
        assert_eq!(english.read_class("Wizard"), None);
        assert_eq!(
            english.read_title_word("m ATRIA RCH"),
            Some(Title::Matriarch)
        );
        assert_eq!(english.read_title_word("Marshal"), None);
        assert_eq!(english.read_difficulty("NeRrnAL"), Some(Difficulty::Normal));
        assert_eq!(english.read_difficulty("HELL"), Some(Difficulty::Hell));
        assert!(english.is_level_word("LEWEL"));
        assert!(english.is_level_word("LEVEL"));
        assert!(!english.is_level_word("Lvl"));
        assert!(!english.is_level_word(""));
    }

    #[test]
    fn a_pack_without_a_word_reads_nothing_for_it() {
        let words = words(&[
            (PARTY, "Party"),
            (GAME_NAME, "Game Name"),
            (PASSWORD, "Password"),
        ]);
        let pack = LanguagePack::from_words("xx", words).expect("the pack builds");
        assert_eq!(pack.read_class("Sorceress"), None);
        assert_eq!(pack.read_title_word("Matriarch"), None);
        assert_eq!(pack.read_difficulty("Hell"), None);
        assert!(!pack.is_level_word("Level"));
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

    /// The reads of the small-caps "Game Name" label by the maintainer's Windows OCR (2026-11-12, 1920x1033 print), per variant.
    #[test]
    fn the_real_reads_of_the_game_name_label_are_the_label_and_values_and_password_are_not() {
        let english = LanguagePack::english();
        let label = |text: &str| english.is_label(text, GAME_NAME, &[PASSWORD]);
        for read in [
            "GA m E N A me",    // spaces and case: the squashed word
            "GA me' N Arne",    // `rn` for `m`
            "G A TE-• N A rnE", // one letter and punctuation
            "(3 Arne' N Arne",  // the first letter lost, 1 edit
            "GA me N AllTE",    // `llT` for `m`
            "GAME NAME",
        ] {
            assert!(label(read), "{read}");
        }
        for read in [
            "",
            "GA m E",
            "PASSWORD",
            "PA SS W ORD",
            "MF-FAST-RUN-O1",
            "mmbaalh-12",
            "PARTY",
        ] {
            assert!(!label(read), "{read}");
        }
        assert!(!english.is_label("GAME NAME", "missing-key", &[PASSWORD]));
        assert!(
            !english.is_label("GAME NAME", GAME_NAME, &[GAME_NAME]),
            "a line near an excluded word is no label"
        );
    }

    #[test]
    fn a_garbled_read_is_near_its_word_but_not_another() {
        let english = LanguagePack::english();
        for read in ["Password", "PA55WORD", "PASSVVORD", "P A S S W O R D"] {
            assert!(english.is_near_word(read, PASSWORD), "{read}");
        }
        for read in ["MF-FAST-RUN-O1", "GAME NAME", ""] {
            assert!(!english.is_near_word(read, PASSWORD), "{read}");
        }
        assert!(!english.is_near_word("Password", "missingKey"));
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

/// remote-config T18: the Party words of the configuration replace the pack's, key by key, and nothing else.
#[cfg(test)]
mod phrases_threaded {
    use super::{GAME_NAME, LIFE, LanguagePack, PARTY, PASSWORD};
    use crate::remote_config::{Phrases, Words};

    fn brazilian() -> LanguagePack {
        let mut words: Vec<(String, String)> = LanguagePack::english().words.into_iter().collect();
        for (key, word) in [(PARTY, "Grupo"), (GAME_NAME, "Nome"), (PASSWORD, "Senha")] {
            words.retain(|(held, _)| held != key);
            words.push((key.to_string(), word.to_string()));
        }
        LanguagePack::from_words("pt-BR", words).expect("the pack builds")
    }

    fn pack() -> LanguagePack {
        LanguagePack::english().with_fallback(brazilian())
    }

    fn words(party: &str, game_name: &str, password: &str) -> Words {
        Words {
            party: Some(party.to_string()),
            game_name: Some(game_name.to_string()),
            password: Some(password.to_string()),
        }
    }

    #[test]
    fn nothing_configured_is_the_same_pack() {
        assert_eq!(pack().with_phrases(&Phrases::default()), pack());
    }

    #[test]
    fn the_english_words_replace_the_english_pack_and_not_its_fallback() {
        let phrases = Phrases {
            en: words("Group", "Game Title", "Secret"),
            pt_br: Words::default(),
        };
        let configured = pack().with_phrases(&phrases);
        assert_eq!(configured.word(PARTY), Some("Group"));
        assert_eq!(configured.word(GAME_NAME), Some("Game Title"));
        assert_eq!(configured.word(PASSWORD), Some("Secret"));
        let fallback = configured.fallback().expect("the fallback stays");
        assert_eq!(fallback, &brazilian());
    }

    #[test]
    fn the_portuguese_words_replace_only_the_fallback() {
        let phrases = Phrases {
            en: Words::default(),
            pt_br: words("Grupo novo", "Nome novo", "Senha nova"),
        };
        let configured = pack().with_phrases(&phrases);
        assert_eq!(configured.word(PARTY), Some("Party"));
        let fallback = configured.fallback().expect("the fallback stays");
        assert_eq!(fallback.word(PARTY), Some("Grupo novo"));
        assert_eq!(fallback.word(GAME_NAME), Some("Nome novo"));
        assert_eq!(fallback.word(PASSWORD), Some("Senha nova"));
    }

    #[test]
    fn a_word_that_is_absent_or_blank_stays_the_packs() {
        let phrases = Phrases {
            en: Words {
                party: Some("Group".to_string()),
                game_name: Some("   ".to_string()),
                password: None,
            },
            pt_br: Words::default(),
        };
        let configured = pack().with_phrases(&phrases);
        assert_eq!(configured.word(PARTY), Some("Group"));
        assert_eq!(configured.word(GAME_NAME), Some("Game Name"));
        assert_eq!(configured.word(PASSWORD), Some("Password"));
    }

    #[test]
    fn only_the_three_party_keys_can_change_and_the_tag_stays() {
        let phrases = Phrases {
            en: words("A", "B", "C"),
            pt_br: words("D", "E", "F"),
        };
        let configured = pack().with_phrases(&phrases);
        let built_in = pack();
        assert_eq!(configured.tag(), "en");
        assert_eq!(configured.word(LIFE), built_in.word(LIFE));
        let changed: Vec<&String> = configured
            .words
            .iter()
            .filter(|(key, word)| built_in.words.get(*key) != Some(word))
            .map(|(key, _)| key)
            .collect();
        assert_eq!(changed, [GAME_NAME, PARTY, PASSWORD]);
    }

    #[test]
    fn a_pack_of_another_tag_is_returned_as_it_is() {
        let spanish = LanguagePack::from_words(
            "es",
            LanguagePack::english()
                .words
                .into_iter()
                .collect::<Vec<_>>(),
        )
        .expect("the pack builds");
        let phrases = Phrases {
            en: words("A", "B", "C"),
            pt_br: words("D", "E", "F"),
        };
        assert_eq!(spanish.with_phrases(&phrases), spanish);
    }

    #[test]
    fn a_configured_word_is_read_as_a_literal_by_the_packs_rules() {
        let phrases = Phrases {
            en: words("Group", "Game Title", "Secret"),
            pt_br: Words::default(),
        };
        let configured = pack().with_phrases(&phrases);
        assert!(configured.is_word("Group", PARTY));
        assert!(!configured.is_word("Party", PARTY));
        // A pattern-looking read is not a match: nothing is interpreted.
        assert!(!configured.is_word("G.*p", PARTY));
    }
}
