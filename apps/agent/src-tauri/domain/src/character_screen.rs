//! The character selection screen, read from the text its regions show (CHR-04, CHR-06, CHR-08, CHR-18). The OCR engine (core
//! and the app crate) reads a region; this module decides what the text means. It asks for a region only when a rule needs
//! it and keeps no state between frames. No I/O, no clock, no randomness.
//!
//! A region is read several times (the engine's variants, characters-reading T21) and the readings are combined here: a
//! marker or a popup label counts when any reading shows it; a card's title, name and class/level line need the majority of
//! the readings that agree, and a field the readings do not settle is unknown, so the card is not sent (CHR-06). A reader
//! that gives one reading per region is the case of one variant.

use crate::anchors;
use crate::characters::{Card, Class, Difficulty, Mode, Title, is_character_name};
use crate::language::{CREATE_NEW, DIFFICULTY_LABEL, LIFE, LanguagePack, title_key};
use crate::layout::{CARD_SLOTS, ScreenRegion};
use crate::presence::Screen;
use crate::vision::{Region, TextLine};

/// What one frame shows: its screen, and the complete cards when it is the character selection screen (CHR-04, CHR-06).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    pub screen: Screen,
    pub cards: Vec<Card>,
    /// How many card slots held any text (the regions the reader tried to settle into a card).
    pub slots_read: u8,
    /// The slots that held text but settled no card, each with the field that refused it. Local diagnostics only.
    pub rejected: Vec<Rejection>,
}

/// Why a card slot with text settled no card (CHR-06). A short code, never any text the screen showed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    /// The title line was not read, or its readings neither agree nor read blank.
    TitleUnread,
    /// The name line was not read at all, or no reading is a name.
    NameUnread,
    /// Names were read but the readings do not agree on one.
    NameDisagree,
    /// The level word or the level of the level line is not settled.
    LevelUnread,
    /// The level is settled but the class is not.
    ClassUnread,
    /// The fields settled but together are not a card.
    CardInvalid,
}

impl RejectReason {
    /// The code the window shows.
    pub const fn code(self) -> &'static str {
        match self {
            Self::TitleUnread => "title-unread",
            Self::NameUnread => "name-unread",
            Self::NameDisagree => "name-disagree",
            Self::LevelUnread => "level-unread",
            Self::ClassUnread => "class-unread",
            Self::CardInvalid => "card-invalid",
        }
    }
}

/// A refused card slot and the reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rejection {
    pub slot: u8,
    pub reason: RejectReason,
}

impl Reading {
    /// A reading of a screen that shows no card slot.
    fn without_cards(screen: Screen) -> Self {
        Self {
            screen,
            cards: Vec::new(),
            slots_read: 0,
            rejected: Vec::new(),
        }
    }
}

/// Whether a sampled pixel is the gold of a selected card's top border (CHR-06). The popup dims the list, so the gold of
/// the dimmed border is still well above the grey of an unselected one.
pub fn is_gold(red: u8, green: u8, blue: u8) -> bool {
    let (red, green, blue) = (u16::from(red), u16::from(green), u16::from(blue));
    red >= 70 && red >= blue + 40 && green >= blue + 30
}

/// The luma an enabled popup label reaches. The brightest 1% of the pixels of the Normal, Nightmare and Hell labels read 246
/// on the maintainer's popup screenshot of 2026-11-10, where all three are enabled. A label below 60% of that is dimmed,
/// the look of a difficulty the character does not have (CHR-18).
pub const ENABLED_LABEL_LUMA: u8 = 148;

/// The luma of a pixel: the BT.709 weights in integers.
pub fn luma(red: u8, green: u8, blue: u8) -> u8 {
    let weighted =
        (2126 * u32::from(red) + 7152 * u32::from(green) + 722 * u32::from(blue)) / 10_000;
    u8::try_from(weighted).unwrap_or(u8::MAX)
}

/// The brightness of a label: the luma of its brightest 1% of pixels, which are the strokes of its text rather than its
/// frame. `None` for a label with no pixels.
pub fn label_brightness(mut lumas: Vec<u8>) -> Option<u8> {
    lumas.sort_unstable();
    let last = lumas.len().checked_sub(1)?;
    lumas.get(last * 99 / 100).copied()
}

/// Whether a label is as bright as an enabled one (CHR-18).
pub fn is_enabled_label(brightness: u8) -> bool {
    brightness >= ENABLED_LABEL_LUMA
}

/// The readings of one region: one text per OCR variant, or `None` when the region could not be read at all.
pub type Readings = Option<Vec<String>>;

/// Whether any reading of a region satisfies `test`.
fn any_reading(readings: &Readings, test: impl Fn(&str) -> bool) -> bool {
    readings
        .as_deref()
        .is_some_and(|all| all.iter().any(|read| test(read)))
}

/// Reads a character selection frame, anchored on what the screen shows (the full-screen incident, 0.1.3): the panels sit at
/// other offsets in a full-screen client than in a maximized one, so the cards and the popup's options are found by the text
/// of the lines read in their search areas (`anchors`), not at fixed offsets.
///
/// `text` returns the readings of a marker region (or `None` when it could not be read); `lines` returns the lines of a
/// search area (`ScreenRegion::PopupArea`, `ScreenRegion::CardColumn`) with where each sits; `field` returns the readings of
/// a region found that way, one per OCR variant, and settles under the same agreement rules as before; `selected` says
/// whether the card whose name line is that region shows the gold frame; `lit` says whether a popup option (the region of
/// its line) is as bright as an enabled one (`is_enabled_label`). `frame_height` scales the distances between lines.
pub fn read_screen<T, A, F, S, L>(
    pack: &LanguagePack,
    frame_height: u32,
    mut text: T,
    mut lines: A,
    mut field: F,
    mut selected: S,
    mut lit: L,
) -> Reading
where
    T: FnMut(ScreenRegion) -> Readings,
    A: FnMut(ScreenRegion) -> Vec<Vec<TextLine>>,
    F: FnMut(Region) -> Readings,
    S: FnMut(Region) -> bool,
    L: FnMut(Region) -> bool,
{
    let automap = any_reading(&text(ScreenRegion::AreaDifficulty), |read| {
        pack.begins_with(read, DIFFICULTY_LABEL)
    });
    if automap {
        return Reading::without_cards(Screen::AutomapOpen);
    }
    let in_game = any_reading(&text(ScreenRegion::Life), |read| {
        pack.begins_with(read, LIFE)
    });
    if in_game {
        return Reading::without_cards(Screen::InGame);
    }
    let list = any_reading(&text(ScreenRegion::CreateNew), |read| {
        pack.is_word(read, CREATE_NEW) || pack.is_squashed_word(read, CREATE_NEW)
    });
    let popup_lines = lines(ScreenRegion::PopupArea);
    let popup_title = anchors::popup_title_in_variants(pack, &popup_lines);
    let popup = popup_difficulties(pack, &popup_lines, &mut field, &mut lit);
    if !list && !popup_title && popup.is_none() {
        return Reading::without_cards(Screen::Unknown);
    }
    let enabled = popup.filter(|difficulties| !difficulties.is_empty());
    let mut cards = Vec::new();
    let mut rejected = Vec::new();
    let mut slots_read = 0;
    let mut popup_applied = false;
    let column = lines(ScreenRegion::CardColumn);
    for (slot, anchor) in anchors::find_cards_in_variants(pack, &column, frame_height)
        .into_iter()
        .take(usize::from(CARD_SLOTS))
        .enumerate()
    {
        let slot = u8::try_from(slot).unwrap_or(u8::MAX);
        slots_read += 1;
        // A card with no title line has a blank title; a known title line is read like any other field; a line that is
        // there but is no title (the engine garbled it) settles nothing, so the card is refused with `title-unread`.
        let title = match anchor.title {
            anchors::TitleLine::Known(region) => field(region),
            anchors::TitleLine::None => Some(vec![String::new()]),
            anchors::TitleLine::Unknown => None,
        };
        let name = field(anchor.name);
        let level = field(anchor.level);
        // The popup belongs to the selected card: the first card with the gold frame (CHR-18).
        let is_selected = enabled.is_some() && !popup_applied && selected(anchor.name);
        if is_selected {
            popup_applied = true;
        }
        let card = match read_card(pack, title, name, level) {
            Ok(card) => card,
            Err(reason) => {
                rejected.push(Rejection { slot, reason });
                continue;
            }
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
        slots_read,
        rejected,
    }
}

/// How many of the popup's three difficulty words must read for the popup to count as open.
const POPUP_LABELS_TO_OPEN: usize = 2;

/// The popup, from its options (CHR-18): it is open when at least two of the three difficulty words are found (the title
/// reads too poorly to decide). An option is found by its word in the lines of the popup's area; one the lines missed is
/// looked for at the pitch of the other two and counts when any variant reading of that place shows its word. Then `Some`
/// holds the difficulties whose label is also as bright as an enabled one: a dimmed label may still read, so its brightness
/// decides too. `None` when the popup is not open.
fn popup_difficulties<F, L>(
    pack: &LanguagePack,
    lines: &[Vec<TextLine>],
    field: &mut F,
    lit: &mut L,
) -> Option<Vec<Difficulty>>
where
    F: FnMut(Region) -> Readings,
    L: FnMut(Region) -> bool,
{
    let found = anchors::popup_options_in_variants(pack, lines);
    let mut options = found.clone();
    for (difficulty, region) in anchors::missing_options(&found) {
        if any_reading(&field(region), |read| {
            pack.read_difficulty(read) == Some(difficulty)
        }) {
            options.push((difficulty, region));
        }
    }
    if options.len() < POPUP_LABELS_TO_OPEN {
        return None;
    }
    options.sort_by_key(|(difficulty, _)| {
        anchors::DIFFICULTIES
            .iter()
            .position(|listed| listed == difficulty)
    });
    Some(
        options
            .into_iter()
            .filter(|(_, region)| lit(*region))
            .map(|(difficulty, _)| difficulty)
            .collect(),
    )
}

/// The value most readings agree on: the one reading when there is one, else the value at least two readings agree on and
/// no other value matches in count. `None` outcomes (a reading that settled nothing) count for no value.
pub fn majority<T: PartialEq>(outcomes: Vec<Option<T>>) -> Option<T> {
    let total = outcomes.len();
    let mut tallies: Vec<(T, usize)> = Vec::new();
    for outcome in outcomes.into_iter().flatten() {
        match tallies.iter_mut().find(|(value, _)| *value == outcome) {
            Some((_, count)) => *count += 1,
            None => tallies.push((outcome, 1)),
        }
    }
    let top = tallies.iter().map(|(_, count)| *count).max()?;
    if top < total.min(2) {
        return None;
    }
    let mut leaders = tallies.into_iter().filter(|(_, count)| *count == top);
    let (winner, _) = leaders.next()?;
    leaders.next().is_none().then_some(winner)
}

/// A card from its three fields. A field that was not read, or that the readings do not settle, refuses the card (CHR-06): a
/// card with a missing title read is refused, while a title that reads blank is a card without a title.
fn read_card(
    pack: &LanguagePack,
    title: Readings,
    name: Readings,
    level: Readings,
) -> Result<Card, RejectReason> {
    let title = title
        .as_deref()
        .and_then(|readings| read_title_readings(pack, readings))
        .ok_or(RejectReason::TitleUnread)?;
    let name = name_or_reason(name.as_deref())?;
    let (level, class) = level_and_class(pack, level.as_deref())?;
    let mode = title.map_or(Mode::Softcore, Title::mode);
    Card::new(&name, class, level, mode, title).map_err(|_| RejectReason::CardInvalid)
}

/// The name a name line settles on, or why it does not.
fn name_or_reason(readings: Option<&[String]>) -> Result<String, RejectReason> {
    let readings = readings.ok_or(RejectReason::NameUnread)?;
    if let Some(name) = read_name_readings(readings) {
        return Ok(name);
    }
    if readings.iter().any(|read| read_name_line(read).is_some()) {
        Err(RejectReason::NameDisagree)
    } else {
        Err(RejectReason::NameUnread)
    }
}

/// The level and class a level line settles on, or which of the two is missing.
fn level_and_class(
    pack: &LanguagePack,
    readings: Option<&[String]>,
) -> Result<(u8, Class), RejectReason> {
    let readings = readings.ok_or(RejectReason::LevelUnread)?;
    let settled = majority(
        readings
            .iter()
            .map(|read| parse_level_and_class(read, pack))
            .collect(),
    );
    if let Some(found) = settled {
        return Ok(found);
    }
    let level_read = readings.iter().any(|read| level_of(read, pack).is_some());
    Err(if level_read {
        RejectReason::ClassUnread
    } else {
        RejectReason::LevelUnread
    })
}

/// The level of a level line, whatever follows it.
pub(crate) fn level_of(text: &str, pack: &LanguagePack) -> Option<u8> {
    let mut words = text.split_whitespace();
    pack.is_level_word(words.next()?)
        .then(|| words.next().and_then(read_level))
        .flatten()
}

/// The title the readings of a title line settle on: `Some(None)` when they agree it is blank, `Some(Some(title))` for a
/// title of the pack, `None` when they do not settle.
fn read_title_readings(pack: &LanguagePack, readings: &[String]) -> Option<Option<Title>> {
    majority(
        readings
            .iter()
            .map(|read| {
                if read.trim().is_empty() {
                    Some(None)
                } else {
                    pack.read_title_word(read).map(Some)
                }
            })
            .collect(),
    )
}

/// The name the readings of a name line settle on: the spelling of the first reading among those that agree, compared in
/// upper case (the game draws names in small caps, so the case is not on the screen). Readings that are not a name (noise
/// such as "VI-JK VUKA") settle nothing. A name settles only when at least two readings agree on it and no rival name has
/// as many readings (a single-reading reader keeps its reading); `None` when names compete without a winner, or when none
/// reads (characters-reading T24).
fn read_name_readings(readings: &[String]) -> Option<String> {
    let names: Vec<Option<String>> = readings.iter().map(|read| read_name_line(read)).collect();
    let upper: Vec<Option<String>> = names
        .iter()
        .map(|name| name.as_ref().map(|name| name.to_uppercase()))
        .collect();
    let settled = majority(upper)?;
    names
        .into_iter()
        .flatten()
        .find(|name| name.to_uppercase() == settled)
}

/// One reading of a name line: the words joined (a name has no space, so a space is a gap the engine left between glyphs),
/// after a lone leading stroke (`i`, `l`, `|`: the edge of the card's frame, as in "i vuKVUKA") is dropped.
fn read_name_line(read: &str) -> Option<String> {
    let mut words = read.split_whitespace().peekable();
    if words
        .peek()
        .is_some_and(|first| matches!(*first, "i" | "l" | "|"))
    {
        words.next();
    }
    read_name(&words.collect::<String>())
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

/// The level and the class of a "Level 88 Sorceress" line (CHR-06). The level word and the class are the nearest words of
/// the pack (`vocabulary`); the level is the token after the level word, read by `read_level`. The class is the rest of the
/// line.
pub fn parse_level_and_class(text: &str, pack: &LanguagePack) -> Option<(u8, Class)> {
    let mut words = text.split_whitespace();
    let word = words.next()?;
    if !pack.is_level_word(word) {
        return None;
    }
    let level = read_level(words.next()?)?;
    let rest = words.collect::<Vec<_>>().join(" ");
    let class = pack.read_class(&rest)?;
    Some((level, class))
}

/// A level from its token, 1 to 99. The engine confuses digits with letters, so the strokes `I`, `l` and `|` read as one,
/// `O`, `D`, `Q` and the D2R glyphs of the letter o as zero, `B` as eight, `S` as five, `Z` as two and `G` as six. Anything
/// else, or a level outside 1 to 99, is unknown.
pub fn read_level(token: &str) -> Option<u8> {
    let mut digits = String::new();
    for c in token.chars() {
        digits.push(match c {
            'I' | 'l' | '|' => '1',
            '⊕' | 'Ø' | 'ø' => '0',
            other => match other.to_ascii_uppercase() {
                'I' => '1',
                'O' | 'D' | 'Q' => '0',
                'B' => '8',
                'S' => '5',
                'Z' => '2',
                'G' => '6',
                digit if digit.is_ascii_digit() => digit,
                _ => return None,
            },
        });
    }
    let level: u32 = digits.parse().ok()?;
    u8::try_from(level)
        .ok()
        .filter(|level| (1..=99).contains(level))
}

#[cfg(test)]
mod tests {
    use super::{
        ENABLED_LABEL_LUMA, Reading, Readings, is_enabled_label, is_gold, label_brightness, luma,
        majority, parse_level_and_class, read_level, read_name, read_screen, read_title,
    };
    use crate::characters::{Class, Difficulty, Mode, Title};
    use crate::language::LanguagePack;
    use crate::layout::{CARD_SLOTS, ScreenRegion, screen_region};
    use crate::presence::Screen;
    use crate::vision::{Region, TextLine};

    use Difficulty::{Hell, Nightmare, Normal};

    /// The height of the client the scenes are drawn on: the 1920×1033 reference, where each region is a line's box.
    const HEIGHT: u32 = 1033;

    fn area(region: ScreenRegion) -> Region {
        screen_region(region, 1920, HEIGHT).expect("the reference client resolves every region")
    }

    /// The region a box of the reference client is, by name: the line a scene draws there.
    fn key_of(region: Region) -> Option<ScreenRegion> {
        let cards = (0..CARD_SLOTS).flat_map(|slot| {
            [
                ScreenRegion::CardTitle(slot),
                ScreenRegion::CardName(slot),
                ScreenRegion::CardLevel(slot),
            ]
        });
        cards
            .chain([
                ScreenRegion::PopupNormal,
                ScreenRegion::PopupNightmare,
                ScreenRegion::PopupHell,
            ])
            .find(|key| area(*key) == region)
    }

    /// A screen as the OCR shows it: the readings of each region, one per variant. The first reading of a card field or a
    /// popup option is the line the lines pass found there (a blank reading is no line); the readings are what the same
    /// place reads when it is read again, once per variant.
    struct Scene {
        sets: Vec<(ScreenRegion, Vec<String>)>,
    }

    impl Scene {
        fn of(sets: &[(ScreenRegion, &[&str])]) -> Self {
            Self {
                sets: sets
                    .iter()
                    .map(|(region, texts)| {
                        (
                            *region,
                            texts.iter().map(|text| (*text).to_string()).collect(),
                        )
                    })
                    .collect(),
            }
        }

        fn readings(&self, region: ScreenRegion) -> Readings {
            self.sets
                .iter()
                .find(|(listed, _)| *listed == region)
                .map(|(_, texts)| texts.clone())
        }

        /// The lines of a search area, one set per variant: each listed region of it whose reading in that variant is not blank.
        fn lines(&self, search: ScreenRegion) -> Vec<Vec<TextLine>> {
            let in_search = |region: &ScreenRegion| {
                matches!(
                    (search, region),
                    (
                        ScreenRegion::PopupArea,
                        ScreenRegion::SelectDifficulty
                            | ScreenRegion::PopupNormal
                            | ScreenRegion::PopupNightmare
                            | ScreenRegion::PopupHell,
                    ) | (
                        ScreenRegion::CardColumn,
                        ScreenRegion::CardTitle(_)
                            | ScreenRegion::CardName(_)
                            | ScreenRegion::CardLevel(_),
                    )
                )
            };
            let variants = self
                .sets
                .iter()
                .map(|(_, texts)| texts.len())
                .max()
                .unwrap_or(0);
            (0..variants)
                .map(|variant| {
                    self.sets
                        .iter()
                        .filter(|(region, _)| in_search(region))
                        .filter_map(|(region, texts)| {
                            let text = texts.get(variant).filter(|text| !text.trim().is_empty())?;
                            Some(TextLine {
                                text: text.clone(),
                                region: area(*region),
                            })
                        })
                        .collect()
                })
                .collect()
        }

        fn field(&self, region: Region) -> Readings {
            self.readings(key_of(region)?)
        }

        /// Reads the scene; the cards in `selected` show the gold frame, the popup options in `dimmed` are drawn dim.
        fn read(&self, selected: &[u8], dimmed: &[ScreenRegion]) -> Reading {
            read_screen(
                &LanguagePack::english(),
                HEIGHT,
                |region| self.readings(region),
                |search| self.lines(search),
                |region| self.field(region),
                |name| matches!(key_of(name), Some(ScreenRegion::CardName(slot)) if selected.contains(&slot)),
                |region| key_of(region).is_some_and(|key| !dimmed.contains(&key)),
            )
        }
    }

    /// The scene of a list of `(region, text)` pairs, one reading each.
    fn single(pairs: &[(ScreenRegion, &str)]) -> Scene {
        Scene {
            sets: pairs
                .iter()
                .map(|(region, text)| (*region, vec![(*text).to_string()]))
                .collect(),
        }
    }

    fn read(pairs: &[(ScreenRegion, &str)], selected: &[u8]) -> Reading {
        read_dimmed(pairs, selected, &[])
    }

    /// Reads the frame with the popup labels in `dimmed` as dim (not as bright as an enabled label): the text still reads.
    fn read_dimmed(
        pairs: &[(ScreenRegion, &str)],
        selected: &[u8],
        dimmed: &[ScreenRegion],
    ) -> Reading {
        single(pairs).read(selected, dimmed)
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
        pairs.push((ScreenRegion::CardTitle(1), "Marshal"));
        let reading = read(&pairs, &[]);
        assert_eq!(
            reading.cards.len(),
            1,
            "a title line that is not of the pack refuses its card"
        );
        assert_eq!(reading.rejected.len(), 1);
        assert_eq!(reading.rejected[0].reason.code(), "title-unread");
    }

    #[test]
    fn a_card_without_a_title_line_has_no_title() {
        let mut pairs = list();
        pairs.retain(|(region, _)| *region != ScreenRegion::CardTitle(1));
        let reading = read(&pairs, &[]);
        assert_eq!(reading.cards.len(), 2);
        assert_eq!(reading.cards[1].title(), None);
    }

    #[test]
    fn a_refused_card_is_reported_with_the_field_that_refused_it() {
        let reasons = |pairs: &[(ScreenRegion, &str)]| -> Vec<(u8, &'static str)> {
            read(pairs, &[])
                .rejected
                .iter()
                .map(|rejection| (rejection.slot, rejection.reason.code()))
                .collect()
        };
        let without = |region: ScreenRegion| -> Vec<(ScreenRegion, &'static str)> {
            let mut pairs = list();
            pairs.retain(|(found, _)| *found != region);
            pairs
        };
        let with = |region: ScreenRegion, text: &'static str| {
            let mut pairs = without(region);
            pairs.push((region, text));
            pairs
        };

        assert_eq!(reasons(&list()), []);
        assert_eq!(read(&list(), &[]).slots_read, 2);
        assert_eq!(
            reasons(&with(ScreenRegion::CardTitle(1), "Marshal")),
            [(1, "title-unread")]
        );
        assert_eq!(
            reasons(&with(ScreenRegion::CardName(1), "12-34")),
            [(1, "name-unread")]
        );
        assert_eq!(
            reasons(&with(ScreenRegion::CardLevel(1), "Level 88 Zzzz")),
            [(1, "class-unread")]
        );
        // A card is found by its level line: without a name line above it, or without a level line, there is no card to
        // refuse, and the other card is read all the same.
        for card_without in [ScreenRegion::CardName(1), ScreenRegion::CardLevel(1)] {
            let reading = read(&without(card_without), &[]);
            assert!(reading.rejected.is_empty());
            assert_eq!(reading.slots_read, 1);
            assert_eq!(reading.cards.len(), 1);
        }
    }

    #[test]
    fn readings_that_name_two_different_characters_refuse_with_name_disagree() {
        let scene = Scene::of(&[
            (ScreenRegion::CreateNew, &["Create New"]),
            (ScreenRegion::CardTitle(0), &["", ""]),
            (ScreenRegion::CardName(0), &["Alpha", "Bravo"]),
            (
                ScreenRegion::CardLevel(0),
                &["Level 88 Sorceress", "Level 88 Sorceress"],
            ),
        ]);
        let rejected = scene.read(&[], &[]).rejected;
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].reason.code(), "name-disagree");
    }

    #[test]
    fn a_screen_without_card_slots_reports_no_slot_and_no_rejection() {
        let reading = read(&[(ScreenRegion::Life, "Life: 925 / 925")], &[]);
        assert_eq!(reading.slots_read, 0);
        assert!(reading.rejected.is_empty());
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

    #[test]
    fn a_dimmed_difficulty_label_is_not_an_enabled_difficulty_even_when_it_reads() {
        let mut pairs = list();
        pairs.push((ScreenRegion::SelectDifficulty, "Select Difficulty"));
        pairs.push((ScreenRegion::PopupNormal, "Normal"));
        pairs.push((ScreenRegion::PopupNightmare, "Nightmare"));
        pairs.push((ScreenRegion::PopupHell, "Hell"));
        let dimmed = [ScreenRegion::PopupNightmare, ScreenRegion::PopupHell];
        let reading = read_dimmed(&pairs, &[0], &dimmed);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal],
            "the popup with Nightmare and Hell dimmed enables Normal alone"
        );
    }

    #[test]
    fn a_popup_whose_labels_are_all_dimmed_enables_no_difficulty_and_applies_nothing() {
        let mut pairs = list();
        pairs.push((ScreenRegion::SelectDifficulty, "Select Difficulty"));
        pairs.push((ScreenRegion::PopupNormal, "Normal"));
        let dimmed = [ScreenRegion::PopupNormal];
        let reading = read_dimmed(&pairs, &[0], &dimmed);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell],
            "no enabled label: the title's difficulties stand"
        );
    }

    #[test]
    fn a_label_is_enabled_from_the_luma_of_an_enabled_label_down_to_60_percent() {
        assert_eq!(ENABLED_LABEL_LUMA, 148);
        assert!(!is_enabled_label(ENABLED_LABEL_LUMA - 1));
        assert!(is_enabled_label(ENABLED_LABEL_LUMA));
        assert!(is_enabled_label(246), "the maintainer's enabled labels");
    }

    #[test]
    fn the_label_brightness_is_the_brightest_percent_of_its_pixels() {
        assert_eq!(label_brightness(Vec::new()), None);
        assert_eq!(label_brightness(vec![60; 100]), Some(60));
        let mut text_and_frame = vec![60; 90];
        text_and_frame.extend([246; 10]);
        assert_eq!(
            label_brightness(text_and_frame),
            Some(246),
            "ten bright pixels of a hundred are the text"
        );
    }

    #[test]
    fn the_luma_weights_green_most_and_keeps_the_extremes() {
        assert_eq!(luma(0, 0, 0), 0);
        assert_eq!(luma(255, 255, 255), 255);
        assert_eq!(luma(236, 226, 196), 225);
        assert!(luma(0, 255, 0) > luma(255, 0, 0));
    }

    #[test]
    fn a_level_token_reads_the_digits_the_engine_confuses() {
        assert_eq!(read_level("88"), Some(88));
        assert_eq!(read_level("8B"), Some(88));
        assert_eq!(read_level("B8"), Some(88));
        assert_eq!(read_level("II"), Some(11));
        assert_eq!(read_level("1I"), Some(11));
        assert_eq!(read_level("l1"), Some(11));
        assert_eq!(read_level("S"), Some(5));
        assert_eq!(read_level("Z"), Some(2));
        assert_eq!(read_level("G9"), Some(69));
        assert_eq!(read_level("1O"), Some(10));
        assert_eq!(read_level("1D"), Some(10));
        assert_eq!(read_level("1Q"), Some(10));
        assert_eq!(read_level("1Ø"), Some(10));
        assert_eq!(read_level("99"), Some(99));
        assert_eq!(read_level("1"), Some(1));
    }

    #[test]
    fn a_level_token_outside_one_to_ninety_nine_or_with_another_letter_is_unknown() {
        assert_eq!(read_level("100"), None);
        assert_eq!(read_level("0"), None);
        assert_eq!(read_level("OO"), None);
        assert_eq!(read_level(""), None);
        assert_eq!(read_level("8X"), None);
        assert_eq!(read_level("A8"), None);
        assert_eq!(read_level("-8"), None);
    }

    #[test]
    fn a_confusable_letter_maps_only_as_documented_and_any_other_letter_stays_unknown() {
        // Documented map: I l | -> 1, O D Q Ø ø ⊕ -> 0, B -> 8, S -> 5, Z -> 2, G -> 6.
        assert_eq!(read_level("S0"), Some(50));
        assert_eq!(read_level("|0"), Some(10));
        // Letters outside the map never become a digit.
        for token in ["X8", "8X", "A8", "T5", "E8", "K1", "8 8", " 8", "8 ", "８8"] {
            assert_eq!(read_level(token), None, "{token:?}");
        }
        // A map that lands outside 1 to 99 is unknown.
        for token in ["0", "00", "O", "OO", "100", "1OO", "S00", "B88"] {
            assert_eq!(read_level(token), None, "{token:?}");
        }
    }

    #[test]
    fn the_real_reads_of_the_level_line_parse() {
        let pack = LanguagePack::english();
        for (read, expected) in [
            ("LEWEL 88 Sa RCERESS", (88, Class::Sorceress)),
            ("LEVEL 88 SBRCERESS", (88, Class::Sorceress)),
            ("LEVEL 88 SeRCERESS", (88, Class::Sorceress)),
            ("LEWEL II SBRCERESS", (11, Class::Sorceress)),
            ("LEVEL II SGRCERESS", (11, Class::Sorceress)),
            ("LEVEL 8B RCERESS", (88, Class::Sorceress)),
            ("LEVEL 88 S*acEREss", (88, Class::Sorceress)),
        ] {
            assert_eq!(
                parse_level_and_class(read, &pack),
                Some(expected),
                "{read:?}"
            );
        }
        assert_eq!(parse_level_and_class("LEVEL 88 WIZARD", &pack), None);
        assert_eq!(parse_level_and_class("LVL 88 SORCERESS", &pack), None);
    }

    fn read_variants(sets: &[(ScreenRegion, &[&str])], selected: &[u8]) -> Reading {
        Scene::of(sets).read(selected, &[])
    }

    /// The first `ocr-real` run on the maintainer's selection screen (2026-11-11): the variants of each region. The first
    /// card's name reads "VI-JK VUKA" (a valid name, with its hyphen), "i vuKVUKA" and twice blank: two valid names with one
    /// reading each, so the card is not sent rather than sent with a guess (CHR-06).
    #[test]
    fn the_real_selection_screen_refuses_the_card_whose_name_two_readings_contest() {
        let sets: [(ScreenRegion, &[&str]); 8] = [
            (
                ScreenRegion::CreateNew,
                &["CREATE NEW", "CREATE NEW", "CREATE NEW", "CREATE NEW"],
            ),
            (
                ScreenRegion::CardTitle(0),
                &["m ATRIARCH", "m ATRIARCH", "m A TRIARCH", "m ATRIA RCH"],
            ),
            (
                ScreenRegion::CardName(0),
                &["VI-JK VUKA", "i vuKVUKA", "", ""],
            ),
            (
                ScreenRegion::CardLevel(0),
                &[
                    "LEWEL 88 Sa RCERESS",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SeRCERESS",
                    "LEVEL 88 SBRCERESS",
                ],
            ),
            (ScreenRegion::CardTitle(1), &["", "", "", ""]),
            (
                ScreenRegion::CardName(1),
                &["VUKA DAO", "VUKA DAO", "VUKA DAO", "VUKADAO"],
            ),
            (
                ScreenRegion::CardLevel(1),
                &[
                    "LEWEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SGRCERESS",
                    "LEVEL II SeRCERESS",
                ],
            ),
            (ScreenRegion::Life, &["", "", "", ""]),
        ];
        let reading = read_variants(&sets, &[]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        let cards: Vec<String> = reading
            .cards
            .iter()
            .map(|card| {
                format!(
                    "{} {:?} {} {:?}",
                    card.name().to_uppercase(),
                    card.class(),
                    card.level(),
                    card.title()
                )
            })
            .collect();
        assert_eq!(cards, ["VUKADAO Sorceress 11 None"]);
    }

    /// The same run's popup screenshot: every variant of every region, as printed (2026-11-11).
    #[test]
    fn the_real_popup_screen_reads_both_cards_and_the_three_difficulties() {
        let sets: [(ScreenRegion, &[&str]); 12] = [
            (
                ScreenRegion::CreateNew,
                &["CREATE NEW", "CREATE NEW", "CREATE NEW", "CREATE NEW"],
            ),
            (
                ScreenRegion::SelectDifficulty,
                &[
                    "S CT D TY",
                    "S c T CULT Y",
                    "S CT D CULT Y",
                    "S CT D CU LTY",
                ],
            ),
            (
                ScreenRegion::PopupNormal,
                &["NeRtTIAL", "NeRfTIAL", "NeRrTIAL", "NeRrnAL"],
            ),
            (
                ScreenRegion::PopupNightmare,
                &["NIGHTmARE", "N IGHTrnARE", "N HTTTIARE", "NIG"],
            ),
            (ScreenRegion::PopupHell, &["HELL", "HELL", "HELL", "HELL"]),
            (
                ScreenRegion::CardTitle(0),
                &["m ATRIA RCH", "", "m ATRIA RCH", "m ATRIA RCH"],
            ),
            (
                ScreenRegion::CardName(0),
                &["U K VUKA", "VUKVUKA", "VI-JK VUKA", "VUKVUKA"],
            ),
            (
                ScreenRegion::CardLevel(0),
                &[
                    "LEVEL 8B RCERESS",
                    "LEVEL 88 S*acEREss",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SBRCERESS",
                ],
            ),
            (ScreenRegion::CardTitle(1), &["", "", "", ""]),
            (
                ScreenRegion::CardName(1),
                &["I VUKA DAO", "VUKA DAO", "V I.J KA D A", "VUKA DAO"],
            ),
            (
                ScreenRegion::CardLevel(1),
                &[
                    "LEVEL II S*RCERESS",
                    "LEVEL II S*RCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                ],
            ),
            (ScreenRegion::Life, &["", "", "", ""]),
        ];
        let reading = read_variants(&sets, &[0]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        let cards: Vec<String> = reading
            .cards
            .iter()
            .map(|card| {
                format!(
                    "{} {:?} {} {:?}",
                    card.name().to_uppercase(),
                    card.class(),
                    card.level(),
                    card.title()
                )
            })
            .collect();
        assert_eq!(
            cards,
            [
                "VUKVUKA Sorceress 88 Some(Matriarch)",
                "VUKADAO Sorceress 11 None"
            ]
        );
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
    }

    fn card_strings(reading: &Reading) -> Vec<String> {
        reading
            .cards
            .iter()
            .map(|card| {
                format!(
                    "{} {:?} {} {:?}",
                    card.name().to_uppercase(),
                    card.class(),
                    card.level(),
                    card.title()
                )
            })
            .collect()
    }

    /// The second `ocr-real` run (2026-11-12), six readings per region (nearest 3x, 4x, 5x, bilinear 3x, 4x, 5x): the
    /// first card's name has two agreeing readings against one of each rival, so it settles (characters-reading T24).
    #[test]
    fn the_real_selection_screen_reads_both_cards_from_six_readings() {
        let sets: [(ScreenRegion, &[&str]); 8] = [
            (ScreenRegion::CreateNew, &["CREATE NEW"; 6]),
            (
                ScreenRegion::CardTitle(0),
                &[
                    "m ATRIARCH",
                    "m ATRIARCH",
                    "TRIARCH",
                    "m A TRIARCH",
                    "m ATRIA RCH",
                    "TRIARCH",
                ],
            ),
            (
                ScreenRegion::CardName(0),
                &["VI-JK VUKA", "i vuKVUKA", "", "", "", "VUKVUKA"],
            ),
            (
                ScreenRegion::CardLevel(0),
                &[
                    "LEWEL 88 Sa RCERESS",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SeRCERESS",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SBRCERESS",
                ],
            ),
            (ScreenRegion::CardTitle(1), &[""; 6]),
            (
                ScreenRegion::CardName(1),
                &[
                    "VUKA DAO", "VUKA DAO", "VUKA DAO", "VUKA DAO", "VUKADAO", "VUKA DAO",
                ],
            ),
            (
                ScreenRegion::CardLevel(1),
                &[
                    "LEWEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SGRCERESS",
                    "LEVEL II SeRCERESS",
                    "LEVEL II SBRCERESS",
                ],
            ),
            (ScreenRegion::Life, &[""; 6]),
        ];
        let reading = read_variants(&sets, &[]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(
            card_strings(&reading),
            [
                "VUKVUKA Sorceress 88 Some(Matriarch)",
                "VUKADAO Sorceress 11 None"
            ]
        );
    }

    /// The same run's popup screenshot, six readings per region.
    #[test]
    fn the_real_popup_screen_reads_both_cards_from_six_readings() {
        let sets: [(ScreenRegion, &[&str]); 12] = [
            (ScreenRegion::CreateNew, &["CREATE NEW"; 6]),
            (
                ScreenRegion::SelectDifficulty,
                &[
                    "S CT D TY",
                    "S c T CULT Y",
                    "S c T CULT Y",
                    "S CT D CULT Y",
                    "S CT D CU LTY",
                    "S CT DIFFI CULT Y",
                ],
            ),
            (
                ScreenRegion::PopupNormal,
                &[
                    "NeRtTIAL", "NeRfTIAL", "NeR(TlAL", "NeRrTIAL", "NeRrnAL", "NeRrTIAL",
                ],
            ),
            (
                ScreenRegion::PopupNightmare,
                &[
                    "NIGHTmARE",
                    "N IGHTrnARE",
                    "N HTrnARE",
                    "N HTTTIARE",
                    "NIG",
                    "N HTTTIARE",
                ],
            ),
            (ScreenRegion::PopupHell, &["HELL"; 6]),
            (
                ScreenRegion::CardTitle(0),
                &[
                    "m ATRIA RCH",
                    "",
                    "[TIA TRIARCH",
                    "m ATRIA RCH",
                    "m ATRIA RCH",
                    "m A TRIARCH",
                ],
            ),
            (
                ScreenRegion::CardName(0),
                &[
                    "U K VUKA",
                    "VUKVUKA",
                    "ID vuKVUKA",
                    "VI-JK VUKA",
                    "VUKVUKA",
                    "I VUKVUKA",
                ],
            ),
            (
                ScreenRegion::CardLevel(0),
                &[
                    "LEVEL 8B RCERESS",
                    "LEVEL 88 S*acEREss",
                    "LEVEL 88 S*acEREss",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SBRCERESS",
                    "LEVEL 88 SBRCERESS",
                ],
            ),
            (ScreenRegion::CardTitle(1), &[""; 6]),
            (
                ScreenRegion::CardName(1),
                &[
                    "I VUKA DAO",
                    "VUKA DAO",
                    "U KA DAO",
                    "V I.J KA D A",
                    "VUKA DAO",
                    "VUKA DAO",
                ],
            ),
            (
                ScreenRegion::CardLevel(1),
                &[
                    "LEVEL II S*RCERESS",
                    "LEVEL II S*RCERESS",
                    "LEVEL II S*RCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                    "LEVEL II SBRCERESS",
                ],
            ),
            (ScreenRegion::Life, &[""; 6]),
        ];
        let reading = read_variants(&sets, &[0]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(
            card_strings(&reading),
            [
                "VUKVUKA Sorceress 88 Some(Matriarch)",
                "VUKADAO Sorceress 11 None"
            ]
        );
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
    }

    #[test]
    fn a_name_needs_two_agreeing_readings_that_outnumber_every_rival() {
        let names = |reads: &[&str]| {
            super::read_name_readings(&reads.iter().map(|r| (*r).to_string()).collect::<Vec<_>>())
        };
        assert_eq!(names(&["VUKVUKA"]), Some("VUKVUKA".to_string()));
        assert_eq!(
            names(&["VUKVUKA", "", "vukvuka", "VUKADAO"]),
            Some("VUKVUKA".to_string()),
            "two agree, one rival"
        );
        assert_eq!(
            names(&["VUKVUKA", "VUKVUKA", "VUKADAO", "VUKADAO"]),
            None,
            "two against two"
        );
        assert_eq!(
            names(&["VUKVUKA", "", "", "VUKADAO"]),
            None,
            "one against one"
        );
        assert_eq!(
            names(&["VUKVUKA", "", "", ""]),
            None,
            "a lone reading among several is not an agreement"
        );
    }

    #[test]
    fn a_level_line_garbled_in_the_first_variants_still_yields_the_card_from_a_later_one() {
        let sets: [(ScreenRegion, &[&str]); 4] = [
            (ScreenRegion::CreateNew, &["CREATE NEW"]),
            (ScreenRegion::CardTitle(0), &["", "", "", ""]),
            (
                ScreenRegion::CardName(0),
                &["VUKVUKA", "VUKVUKA", "VUKVUKA", "VUKVUKA"],
            ),
            (
                ScreenRegion::CardLevel(0),
                &[
                    "LXXX 8B SQRCERESS",
                    "ZZZ",
                    "LEVEL 88 SORCERESS",
                    "LEVEL 88 SORCERESS",
                ],
            ),
        ];
        let reading = read_variants(&sets, &[]);
        assert_eq!(names_of(&reading), ["VUKVUKA"]);
        assert_eq!(reading.cards[0].level(), 88);
    }

    #[test]
    fn a_level_line_no_variant_reads_yields_no_card() {
        let sets: [(ScreenRegion, &[&str]); 3] = [
            (ScreenRegion::CreateNew, &["CREATE NEW"]),
            (ScreenRegion::CardName(0), &["VUKVUKA", "VUKVUKA"]),
            (ScreenRegion::CardLevel(0), &["LXXX 8B", "ZZZ"]),
        ];
        assert!(read_variants(&sets, &[]).cards.is_empty());
    }

    #[test]
    fn a_popup_word_found_in_one_variant_only_counts() {
        // Normal reads only in the second variant, Nightmare in both, Hell in none: two words are found, so the popup is
        // open, and its enabled difficulties are Normal and Nightmare.
        let sets: [(ScreenRegion, &[&str]); 6] = [
            (ScreenRegion::CreateNew, &["CREATE NEW", "CREATE NEW"]),
            (ScreenRegion::PopupNormal, &["", "NORMAL"]),
            (ScreenRegion::PopupNightmare, &["NIGHTMARE", "NIGHTMARE"]),
            (ScreenRegion::CardTitle(0), &["MATRIARCH", "MATRIARCH"]),
            (ScreenRegion::CardName(0), &["VUKVUKA", "VUKVUKA"]),
            (
                ScreenRegion::CardLevel(0),
                &["LEVEL 88 SORCERESS", "LEVEL 88 SORCERESS"],
            ),
        ];
        let reading = read_variants(&sets, &[0]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare]
        );
        // The first variant alone finds one word: no popup, the title's difficulties stand.
        let first_only: Vec<(ScreenRegion, &[&str])> = sets
            .iter()
            .map(|(region, texts)| (*region, &texts[..1]))
            .collect();
        let reading = read_variants(&first_only, &[0]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
    }

    fn names_of(reading: &Reading) -> Vec<&str> {
        reading.cards.iter().map(|card| card.name()).collect()
    }

    #[test]
    fn a_name_the_readings_do_not_settle_refuses_the_card() {
        let sets: [(ScreenRegion, &[&str]); 5] = [
            (ScreenRegion::CreateNew, &["CREATE NEW", "CREATE NEW"]),
            (ScreenRegion::CardTitle(0), &["", ""]),
            (ScreenRegion::CardName(0), &["VUKVUKA", "VUKADAO"]),
            (
                ScreenRegion::CardLevel(0),
                &["LEVEL 88 SORCERESS", "LEVEL 88 SORCERESS"],
            ),
            (ScreenRegion::Life, &["", ""]),
        ];
        let reading = read_variants(&sets, &[]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert!(
            reading.cards.is_empty(),
            "two names that disagree: {reading:?}"
        );
    }

    #[test]
    fn a_title_that_readings_split_between_blank_and_a_title_refuses_the_card() {
        let sets: [(ScreenRegion, &[&str]); 5] = [
            (ScreenRegion::CreateNew, &["CREATE NEW", "CREATE NEW"]),
            (ScreenRegion::CardTitle(0), &["MATRIARCH", ""]),
            (ScreenRegion::CardName(0), &["VUKVUKA", "VUKVUKA"]),
            (
                ScreenRegion::CardLevel(0),
                &["LEVEL 88 SORCERESS", "LEVEL 88 SORCERESS"],
            ),
            (ScreenRegion::Life, &["", ""]),
        ];
        assert!(read_variants(&sets, &[]).cards.is_empty());
    }

    #[test]
    fn the_popup_is_recognised_by_two_labels_and_enables_only_the_labels_that_read() {
        // The maintainer's popup: the title reads "S CT D TY"; Normal reads only in the last variant, Hell in all.
        let sets: [(ScreenRegion, &[&str]); 8] = [
            (
                ScreenRegion::SelectDifficulty,
                &["S CT D TY", "S c T CULT Y"],
            ),
            (
                ScreenRegion::PopupNormal,
                &["NeRtTIAL", "NeRfTIAL", "NeRrTIAL", "NeRrnAL"],
            ),
            (
                ScreenRegion::PopupNightmare,
                &["NIGHTmARE", "N IGHTrnARE", "N HTTTIARE", "NIG"],
            ),
            (ScreenRegion::PopupHell, &["HELL", "HELL", "HELL", "HELL"]),
            (ScreenRegion::CardTitle(0), &["m ATRIARCH", "m ATRIARCH"]),
            (ScreenRegion::CardName(0), &["VUKVUKA", "VUKVUKA"]),
            (
                ScreenRegion::CardLevel(0),
                &["LEVEL 88 SBRCERESS", "LEVEL 88 SBRCERESS"],
            ),
            (ScreenRegion::Life, &["", ""]),
        ];
        let reading = read_variants(&sets, &[0]);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Normal, Nightmare, Hell]
        );
    }

    #[test]
    fn a_single_reading_settles_a_field_and_two_disagreeing_readings_do_not() {
        assert_eq!(majority(vec![Some(1)]), Some(1));
        assert_eq!(majority(vec![Some(1), Some(1), None]), Some(1));
        assert_eq!(majority(vec![Some(1), Some(2)]), None, "a tie");
        assert_eq!(majority(vec![Some(1), None]), None, "one of two");
        assert_eq!(majority(vec![Some(1), Some(1), Some(2), Some(2)]), None);
        assert_eq!(majority(vec![Some(1), Some(1), Some(1), Some(2)]), Some(1));
        assert_eq!(majority::<u8>(Vec::new()), None);
        assert_eq!(majority::<u8>(vec![None, None]), None);
    }
}
