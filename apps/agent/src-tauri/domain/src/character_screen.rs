//! The character selection screen, read from the text its regions show (CHR-04, CHR-06, CHR-08, CHR-18). The OCR engine (core
//! and the app crate) reads a region; this module decides what the text means. It asks for a region only when a rule needs
//! it and keeps no state between frames. No I/O, no clock, no randomness.

use crate::characters::{Card, Class, Difficulty, Mode, Title, is_character_name};
use crate::language::{
    CHARACTER_LEVEL, CREATE_NEW, DIFFICULTY_HELL, DIFFICULTY_LABEL, DIFFICULTY_NIGHTMARE,
    DIFFICULTY_NORMAL, LIFE, LanguagePack, SELECT_DIFFICULTY, class_key, title_key,
};
use crate::layout::{CARD_SLOTS, ScreenRegion};
use crate::presence::Screen;

/// What one frame shows: its screen, and the complete cards when it is the character selection screen (CHR-04, CHR-06).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    pub screen: Screen,
    pub cards: Vec<Card>,
}

/// The eight classes, in the order of the glossary.
const CLASSES: [Class; 8] = [
    Class::Amazon,
    Class::Assassin,
    Class::Barbarian,
    Class::Druid,
    Class::Necromancer,
    Class::Paladin,
    Class::Sorceress,
    Class::Warlock,
];

/// Whether a sampled pixel is the gold of a selected card's top border (CHR-06). The popup dims the list, so the gold of
/// the dimmed border is still well above the grey of an unselected one.
pub fn is_gold(red: u8, green: u8, blue: u8) -> bool {
    let (red, green, blue) = (u16::from(red), u16::from(green), u16::from(blue));
    red >= 70 && red >= blue + 40 && green >= blue + 30
}

/// Reads a character selection frame. `text` returns the text of a region, or `None` when the region could not be read;
/// `selected` says whether a card slot shows the gold frame. Each region is asked for once.
pub fn read_screen<T, S>(pack: &LanguagePack, mut text: T, mut selected: S) -> Reading
where
    T: FnMut(ScreenRegion) -> Option<String>,
    S: FnMut(u8) -> bool,
{
    let automap = text(ScreenRegion::AreaDifficulty)
        .is_some_and(|read| pack.begins_with(&read, DIFFICULTY_LABEL));
    if automap {
        return Reading {
            screen: Screen::AutomapOpen,
            cards: Vec::new(),
        };
    }
    let in_game = text(ScreenRegion::Life).is_some_and(|read| pack.begins_with(&read, LIFE));
    if in_game {
        return Reading {
            screen: Screen::InGame,
            cards: Vec::new(),
        };
    }
    let popup = text(ScreenRegion::SelectDifficulty)
        .is_some_and(|read| pack.is_word(&read, SELECT_DIFFICULTY));
    let list = text(ScreenRegion::CreateNew).is_some_and(|read| pack.is_word(&read, CREATE_NEW));
    if !popup && !list {
        return Reading {
            screen: Screen::Unknown,
            cards: Vec::new(),
        };
    }
    let enabled = if popup {
        popup_difficulties(pack, &mut text)
    } else {
        None
    };
    let mut cards = Vec::new();
    let mut popup_applied = false;
    for slot in 0..CARD_SLOTS {
        let title = text(ScreenRegion::CardTitle(slot));
        let name = text(ScreenRegion::CardName(slot));
        let level = text(ScreenRegion::CardLevel(slot));
        if ![&title, &name, &level].into_iter().any(filled) {
            continue;
        }
        // The popup belongs to the selected card: the first occupied slot with the gold frame (CHR-18).
        let is_selected = enabled.is_some() && !popup_applied && selected(slot);
        if is_selected {
            popup_applied = true;
        }
        let Some(card) = read_card(pack, title, name, level) else {
            continue;
        };
        let card = match (&enabled, is_selected) {
            (Some(difficulties), true) => card
                .clone()
                .with_popup_difficulties(difficulties)
                .unwrap_or(card),
            _ => card,
        };
        cards.push(card);
    }
    Reading {
        screen: Screen::CharacterSelect,
        cards,
    }
}

/// Whether a field holds text: a region that was read and is not blank.
fn filled(field: &Option<String>) -> bool {
    field.as_deref().is_some_and(|read| !read.trim().is_empty())
}

/// The difficulties the popup shows enabled: a button is enabled when its label reads (CHR-18). `None` when none reads.
fn popup_difficulties<T>(pack: &LanguagePack, text: &mut T) -> Option<Vec<Difficulty>>
where
    T: FnMut(ScreenRegion) -> Option<String>,
{
    let buttons = [
        (
            ScreenRegion::PopupNormal,
            DIFFICULTY_NORMAL,
            Difficulty::Normal,
        ),
        (
            ScreenRegion::PopupNightmare,
            DIFFICULTY_NIGHTMARE,
            Difficulty::Nightmare,
        ),
        (ScreenRegion::PopupHell, DIFFICULTY_HELL, Difficulty::Hell),
    ];
    let enabled: Vec<Difficulty> = buttons
        .into_iter()
        .filter(|(region, key, _)| text(*region).is_some_and(|read| pack.is_word(&read, key)))
        .map(|(_, _, difficulty)| difficulty)
        .collect();
    (!enabled.is_empty()).then_some(enabled)
}

/// A card from its three fields. A field that was not read, or that breaks its rule, refuses the card (CHR-06): a card
/// with a missing title read is refused, while a title that reads blank is a card without a title.
fn read_card(
    pack: &LanguagePack,
    title: Option<String>,
    name: Option<String>,
    level: Option<String>,
) -> Option<Card> {
    let title = read_title(pack, &title?)?;
    let name = read_name(&name?)?;
    let (level, class) = parse_level_and_class(&level?, pack)?;
    let mode = title.map_or(Mode::Softcore, Title::mode);
    Card::new(&name, class, level, mode, title).ok()
}

/// The title a title line reads: `Some(None)` for a blank line, `Some(Some(title))` for a title of the pack, and `None`
/// for any other text.
pub fn read_title(pack: &LanguagePack, text: &str) -> Option<Option<Title>> {
    let text = text.trim();
    if text.is_empty() {
        return Some(None);
    }
    Title::ALL
        .into_iter()
        .find(|title| pack.is_word(text, title_key(*title)))
        .map(Some)
}

/// The name a name line reads. The glyphs D2R draws for the letter o (`⊕`, `Ø`, `ø`) and the zero OCR reads for it are
/// letters in a name, since names hold letters only (CHR-10). `None` when the result breaks the name rule.
pub fn read_name(text: &str) -> Option<String> {
    let name: String = text
        .trim()
        .chars()
        .map(|c| match c {
            '⊕' | 'Ø' | 'ø' | '0' => 'o',
            other => other,
        })
        .collect();
    is_character_name(&name).then_some(name)
}

/// The level and the class of a "Level 88 Sorceress" line (CHR-06). The level word is the pack's; the level is digits, or
/// the vertical strokes D2R draws for the digit one (`II` is 11). The class is the rest of the line.
pub fn parse_level_and_class(text: &str, pack: &LanguagePack) -> Option<(u8, Class)> {
    let mut words = text.split_whitespace();
    let word = words.next()?;
    if !pack.is_word(word, CHARACTER_LEVEL) {
        return None;
    }
    let level = parse_level(words.next()?)?;
    let rest = words.collect::<Vec<_>>().join(" ");
    let class = CLASSES
        .into_iter()
        .find(|class| pack.is_word(&rest, class_key(*class)))?;
    Some((level, class))
}

/// A level from its digits, 1 to 99. The strokes `I`, `l` and `|` read as one, and the letter o or its D2R glyphs as zero.
fn parse_level(token: &str) -> Option<u8> {
    let digits: String = token
        .chars()
        .map(|c| match c {
            'I' | 'l' | '|' => '1',
            'O' | 'o' | 'Ø' | 'ø' | '⊕' => '0',
            other => other,
        })
        .collect();
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let level: u32 = digits.parse().ok()?;
    u8::try_from(level)
        .ok()
        .filter(|level| (1..=99).contains(level))
}

#[cfg(test)]
mod tests {
    use super::{Reading, is_gold, parse_level_and_class, read_name, read_screen, read_title};
    use crate::characters::{Class, Difficulty, Mode, Title};
    use crate::language::LanguagePack;
    use crate::layout::ScreenRegion;
    use crate::presence::Screen;

    use Difficulty::{Hell, Nightmare, Normal};

    /// The text of each region a test fixture shows; a region not listed reads as not read.
    fn texts<'a>(
        pairs: &'a [(ScreenRegion, &'a str)],
    ) -> impl FnMut(ScreenRegion) -> Option<String> + 'a {
        move |region| {
            pairs
                .iter()
                .find(|(listed, _)| *listed == region)
                .map(|(_, text)| (*text).to_string())
        }
    }

    fn read(pairs: &[(ScreenRegion, &str)], selected: &[u8]) -> Reading {
        read_screen(&LanguagePack::english(), texts(pairs), |slot| {
            selected.contains(&slot)
        })
    }

    /// A selection screen with a titled Matriarch (slot 0, gold frame) and an untitled Sorceress (slot 1).
    fn list() -> Vec<(ScreenRegion, &'static str)> {
        vec![
            (ScreenRegion::CreateNew, "Create New"),
            (ScreenRegion::CardTitle(0), "Matriarch"),
            (ScreenRegion::CardName(0), "vukVuka"),
            (ScreenRegion::CardLevel(0), "Level 88 Sorceress"),
            (ScreenRegion::CardTitle(1), ""),
            (ScreenRegion::CardName(1), "vukaDao"),
            (ScreenRegion::CardLevel(1), "Level 11 Sorceress"),
        ]
    }

    #[test]
    fn the_gold_of_a_selected_frame_is_told_from_the_grey_of_an_unselected_one() {
        assert!(is_gold(227, 201, 97), "the selected card, lit");
        assert!(is_gold(114, 101, 49), "the selected card under the popup");
        assert!(!is_gold(108, 108, 105), "an unselected card, lit");
        assert!(!is_gold(54, 54, 53), "an unselected card under the popup");
    }

    #[test]
    fn the_automap_marker_reads_automap_open_before_the_in_game_marker() {
        let pairs = [
            (ScreenRegion::AreaDifficulty, "Difficulty: Hell"),
            (ScreenRegion::Life, "Life: 925 / 925"),
        ];
        assert_eq!(read(&pairs, &[]).screen, Screen::AutomapOpen);
    }

    #[test]
    fn the_life_label_reads_in_game_and_nothing_reads_unknown() {
        let in_game = [(ScreenRegion::Life, "Life: 925 / 925")];
        assert_eq!(read(&in_game, &[]).screen, Screen::InGame);
        assert_eq!(read(&[], &[]).screen, Screen::Unknown);
        assert!(read(&[], &[]).cards.is_empty());
    }

    #[test]
    fn the_create_new_button_reads_the_selection_screen_and_its_cards() {
        let reading = read(&list(), &[0]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(reading.cards.len(), 2);
        let matriarch = &reading.cards[0];
        assert_eq!(matriarch.name(), "vukVuka");
        assert_eq!(matriarch.class(), Class::Sorceress);
        assert_eq!(matriarch.level(), 88);
        assert_eq!(matriarch.mode(), Mode::Softcore);
        assert_eq!(matriarch.title(), Some(Title::Matriarch));
        let untitled = &reading.cards[1];
        assert_eq!(untitled.name(), "vukaDao");
        assert_eq!(untitled.title(), None);
        assert_eq!(untitled.unlocked_difficulties(), vec![Normal]);
    }

    #[test]
    fn a_hardcore_title_makes_the_card_hardcore() {
        let mut pairs = list();
        pairs.push((ScreenRegion::CardTitle(2), "Countess"));
        pairs.push((ScreenRegion::CardName(2), "Ember"));
        pairs.push((ScreenRegion::CardLevel(2), "Level 45 Barbarian"));
        let reading = read(&pairs, &[]);
        let ember = reading
            .cards
            .iter()
            .find(|card| card.name() == "Ember")
            .expect("the card");
        assert_eq!(ember.mode(), Mode::Hardcore);
        assert_eq!(ember.class(), Class::Barbarian);
        assert_eq!(ember.unlocked_difficulties(), vec![Normal, Nightmare]);
    }

    #[test]
    fn a_card_with_an_unread_or_unreadable_field_is_not_registered() {
        let mut pairs = list();
        // Slot 1 loses its level line: the card is refused, the other card is kept.
        pairs.retain(|(region, _)| *region != ScreenRegion::CardLevel(1));
        let reading = read(&pairs, &[]);
        let names: Vec<&str> = reading.cards.iter().map(|card| card.name()).collect();
        assert_eq!(names, ["vukVuka"]);
    }

    #[test]
    fn a_title_line_that_reads_no_title_refuses_the_card() {
        let mut pairs = list();
        pairs.retain(|(region, _)| *region != ScreenRegion::CardTitle(1));
        pairs.push((ScreenRegion::CardTitle(1), "Matriarc"));
        let reading = read(&pairs, &[]);
        assert_eq!(
            reading.cards.len(),
            1,
            "a title that is not of the pack refuses its card"
        );
    }

    #[test]
    fn a_card_whose_title_line_was_not_read_is_refused() {
        let mut pairs = list();
        pairs.retain(|(region, _)| *region != ScreenRegion::CardTitle(1));
        let reading = read(&pairs, &[]);
        assert_eq!(
            reading.cards.len(),
            1,
            "a missing title is not a blank title"
        );
    }

    #[test]
    fn the_popup_sets_the_unlocked_difficulties_of_the_selected_card() {
        let mut pairs = list();
        pairs.push((ScreenRegion::SelectDifficulty, "Select Difficulty"));
        pairs.push((ScreenRegion::PopupNormal, "Normal"));
        pairs.push((ScreenRegion::PopupNightmare, "Nightmare"));
        pairs.push((ScreenRegion::PopupHell, "Hell"));
        let reading = read(&pairs, &[0]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
        assert_eq!(
            reading.cards[1].unlocked_difficulties(),
            vec![Normal],
            "the other card keeps its own"
        );
    }

    #[test]
    fn a_popup_with_a_gap_in_its_difficulties_is_ignored() {
        let mut pairs = list();
        pairs.push((ScreenRegion::SelectDifficulty, "Select Difficulty"));
        pairs.push((ScreenRegion::PopupNormal, "Normal"));
        pairs.push((ScreenRegion::PopupHell, "Hell"));
        let reading = read(&pairs, &[0]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell],
            "the title's difficulties stand"
        );
    }

    #[test]
    fn a_popup_without_a_gold_card_applies_to_no_card() {
        let mut pairs = list();
        pairs.push((ScreenRegion::SelectDifficulty, "Select Difficulty"));
        pairs.push((ScreenRegion::PopupNormal, "Normal"));
        let reading = read(&pairs, &[]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
        assert_eq!(reading.cards[1].unlocked_difficulties(), vec![Normal]);
    }

    #[test]
    fn the_popup_title_alone_reads_the_selection_screen() {
        let pairs = [(ScreenRegion::SelectDifficulty, "SELECT DIFFICULTY")];
        assert_eq!(read(&pairs, &[]).screen, Screen::CharacterSelect);
    }

    #[test]
    fn a_title_reads_blank_as_no_title_and_others_as_a_title_or_nothing() {
        let pack = LanguagePack::english();
        assert_eq!(read_title(&pack, ""), Some(None));
        assert_eq!(read_title(&pack, "  "), Some(None));
        assert_eq!(read_title(&pack, "MATRIARCH"), Some(Some(Title::Matriarch)));
        assert_eq!(read_title(&pack, "Matriarc"), None);
    }

    #[test]
    fn the_level_and_class_line_reads_both_digits_and_the_strokes_of_one() {
        let pack = LanguagePack::english();
        assert_eq!(
            parse_level_and_class("Level 88 Sorceress", &pack),
            Some((88, Class::Sorceress))
        );
        assert_eq!(
            parse_level_and_class("LEVEL II SORCERESS", &pack),
            Some((11, Class::Sorceress))
        );
        assert_eq!(
            parse_level_and_class("Level 11 Sørceress", &pack),
            Some((11, Class::Sorceress))
        );
        assert_eq!(
            parse_level_and_class("Level 1Ø Warlock", &pack),
            Some((10, Class::Warlock))
        );
        assert_eq!(
            parse_level_and_class("Level 99 Amazon", &pack),
            Some((99, Class::Amazon))
        );
    }

    #[test]
    fn a_level_and_class_line_outside_the_rules_reads_nothing() {
        let pack = LanguagePack::english();
        for text in [
            "Level 88",
            "Level 100 Amazon",
            "Level 0 Amazon",
            "Lvl 88 Sorceress",
            "Level 88 Wizard",
            "",
        ] {
            assert_eq!(parse_level_and_class(text, &pack), None, "{text:?}");
        }
    }

    #[test]
    fn a_name_reads_the_drawn_o_as_a_letter_and_breaks_on_anything_else() {
        assert_eq!(read_name("vukaDa⊕"), Some("vukaDao".to_string()));
        assert_eq!(read_name("vukVuka"), Some("vukVuka".to_string()));
        assert_eq!(read_name("a name"), None);
        assert_eq!(read_name("Sorc2"), None);
    }
}
