//! Reading anchored on content (the full-screen incident, 0.1.3). The game's panels sit at other offsets in a full-screen
//! 1920×1080 client than in the maximized 1920×1033 one the fixed boxes of `layout` were measured on, and the offset is not
//! one scale: it shrinks from the top of the screen to the bottom. So the screen readers read the lines of a search area and
//! find what they need by the text of a line: a card by its "Level N Class" line, a popup option by its word, the Party
//! panel's game name by the "Game Name" label above it. This module is the pure part: the lines in, the regions to read out.
//! No I/O, no clock, no randomness.

use crate::characters::Difficulty;
use crate::language::{
    GAME_NAME, LanguagePack, PASSWORD, SELECT_DIFFICULTY, TAB_OFFLINE, TAB_ONLINE,
};
use crate::layout::REFERENCE_HEIGHT;
use crate::vision::{Region, TextLine};

/// A value measured on the reference client (1033 px high) in pixels of a client `height` px high.
fn scaled(reference: u32, height: u32) -> u32 {
    let scaled = (u64::from(reference) * u64::from(height) + u64::from(REFERENCE_HEIGHT) / 2)
        / u64::from(REFERENCE_HEIGHT);
    u32::try_from(scaled).unwrap_or(u32::MAX)
}

/// The most two lines of one card may be apart, from the middle of one to the middle of the other: 4% of the client height
/// (43 px at 1080). Measured on the real full-screen prints, the level line sits 23 px under the name and the name 31 px
/// under the title; the next card's name is 69 px under this card's level line.
fn card_line_gap(height: u32) -> u32 {
    height * 4 / 100
}

/// The most the field of the Party panel may sit under its label: 5% of the client height (54 px at 1080; the measured
/// distance is 28 px).
fn field_gap(height: u32) -> u32 {
    height * 5 / 100
}

/// The lines top to bottom (by the middle of the line).
fn top_down(lines: &[TextLine]) -> Vec<&TextLine> {
    let mut sorted: Vec<&TextLine> = lines.iter().collect();
    sorted.sort_by_key(|line| (line.region.middle_y(), line.region.x));
    sorted
}

/// Whether a line is the ONLINE / OFFLINE tab strip over the character list, by the pack's words.
pub fn is_tab_line(pack: &LanguagePack, text: &str) -> bool {
    [TAB_ONLINE, TAB_OFFLINE]
        .into_iter()
        .any(|key| pack.begins_with(text, key) || pack.is_squashed_word(text, key))
}

/// Where the lines of one character card sit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CardAnchor {
    pub title: TitleLine,
    pub name: Region,
    pub level: Region,
}

/// What sits directly above a card's name line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleLine {
    /// No line within a card's height, or the ONLINE / OFFLINE tab, or another card's level line: the card has no title.
    None,
    /// A line that reads as a title of the pack.
    Known(Region),
    /// A line that is there but is none of the above: a title the engine garbled. The card is refused (a hardcore card
    /// would otherwise read as softcore and land on the wrong ladder).
    Unknown,
}

impl TitleLine {
    /// The region of a known title line.
    pub fn known(self) -> Option<Region> {
        match self {
            Self::Known(region) => Some(region),
            Self::None | Self::Unknown => None,
        }
    }

    /// How much a variant's view of the title line is trusted when variants disagree: a known title over an unknown line
    /// over none (a refusal is safer than a card without its title).
    fn rank(self) -> u8 {
        match self {
            Self::Known(_) => 2,
            Self::Unknown => 1,
            Self::None => 0,
        }
    }
}

/// The cards in the lines read from the character list, top to bottom. A card is found by its "Level N <Class>" line (the
/// level word of the pack and a level); its name is the line just above that one, its title the line above the name only
/// when that line is a known title of the pack. The ONLINE / OFFLINE tab is never a name or a title. A level line with no
/// line above it within a card's height yields no card, and so does a name line that is itself a level line.
pub fn find_cards(pack: &LanguagePack, lines: &[TextLine], frame_height: u32) -> Vec<CardAnchor> {
    let sorted = top_down(lines);
    let gap = card_line_gap(frame_height);
    let is_level = |line: &TextLine| crate::character_screen::level_of(&line.text, pack).is_some();
    let near = |lower: &TextLine, upper: &TextLine| {
        let apart = lower
            .region
            .middle_y()
            .saturating_sub(upper.region.middle_y());
        apart > 0 && apart <= gap
    };
    let mut cards = Vec::new();
    for (index, level) in sorted.iter().enumerate() {
        if !is_level(level) {
            continue;
        }
        let Some(name) = index.checked_sub(1).map(|above| sorted[above]) else {
            continue;
        };
        if !near(level, name) || is_level(name) || is_tab_line(pack, &name.text) {
            continue;
        }
        let above = index
            .checked_sub(2)
            .map(|above| sorted[above])
            .filter(|line| near(name, line));
        let title = match above {
            None => TitleLine::None,
            Some(line) if is_tab_line(pack, &line.text) || is_level(line) => TitleLine::None,
            Some(line) if pack.read_title_word(&line.text).is_some() => {
                TitleLine::Known(line.region)
            }
            Some(_) => TitleLine::Unknown,
        };
        cards.push(CardAnchor {
            title,
            name: name.region,
            level: level.region,
        });
    }
    cards
}

/// The cards found in any variant's lines. A card is the same card in two variants when their level lines overlap
/// vertically; the first variant that found it gives its regions, except that the title line of the most trusted view wins
/// (`TitleLine::rank`). Top to bottom.
pub fn find_cards_in_variants(
    pack: &LanguagePack,
    variants: &[Vec<TextLine>],
    frame_height: u32,
) -> Vec<CardAnchor> {
    let mut cards: Vec<CardAnchor> = Vec::new();
    for lines in variants {
        for found in find_cards(pack, lines, frame_height) {
            match cards
                .iter_mut()
                .find(|card| overlap_vertically(card.level, found.level))
            {
                Some(card) if found.title.rank() > card.title.rank() => {
                    card.title = found.title;
                }
                Some(_) => {}
                None => cards.push(found),
            }
        }
    }
    cards.sort_by_key(|card| card.level.middle_y());
    cards
}

/// Whether two boxes share rows.
fn overlap_vertically(a: Region, b: Region) -> bool {
    a.y < b.bottom() && b.y < a.bottom()
}

/// The popup's options found in any variant's lines: the first variant that found a difficulty gives its line.
pub fn popup_options_in_variants(
    pack: &LanguagePack,
    variants: &[Vec<TextLine>],
) -> Vec<(Difficulty, Region)> {
    DIFFICULTIES
        .into_iter()
        .filter_map(|difficulty| {
            variants
                .iter()
                .flat_map(|lines| popup_options(pack, lines))
                .find(|(found, _)| *found == difficulty)
        })
        .collect()
}

/// Whether any variant's lines show the popup's title.
pub fn popup_title_in_variants(pack: &LanguagePack, variants: &[Vec<TextLine>]) -> bool {
    variants
        .iter()
        .flatten()
        .any(|line| is_popup_title(pack, &line.text))
}

/// The Party panel in any variant's lines: open when any variant shows the title; the label and field of the first variant
/// that found the label with a field under it, else of the first that found the label.
pub fn find_party_in_variants(
    pack: &LanguagePack,
    variants: &[Vec<TextLine>],
    frame_height: u32,
) -> PartyAnchors {
    let found: Vec<PartyAnchors> = variants
        .iter()
        .map(|lines| find_party(pack, lines, frame_height))
        .collect();
    let chosen = found
        .iter()
        .find(|party| party.label.is_some() && party.field.is_some())
        .or_else(|| found.iter().find(|party| party.label.is_some()));
    PartyAnchors {
        open: found.iter().any(|party| party.open),
        label: chosen.and_then(|party| party.label),
        field: chosen.and_then(|party| party.field),
    }
}

/// Whether a line of the popup area is the popup's title.
pub fn is_popup_title(pack: &LanguagePack, text: &str) -> bool {
    pack.is_word(text, SELECT_DIFFICULTY) || pack.is_squashed_word(text, SELECT_DIFFICULTY)
}

/// The popup's options in the order the popup lists them.
pub const DIFFICULTIES: [Difficulty; 3] =
    [Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell];

fn position(difficulty: Difficulty) -> i64 {
    DIFFICULTIES
        .iter()
        .position(|listed| *listed == difficulty)
        .map_or(0, |index| index as i64)
}

/// The popup's options found by their word in the lines of its area: the first line that reads as each difficulty.
pub fn popup_options(pack: &LanguagePack, lines: &[TextLine]) -> Vec<(Difficulty, Region)> {
    let sorted = top_down(lines);
    DIFFICULTIES
        .into_iter()
        .filter_map(|difficulty| {
            sorted
                .iter()
                .find(|line| pack.read_difficulty(&line.text) == Some(difficulty))
                .map(|line| (difficulty, line.region))
        })
        .collect()
}

/// Where the options the lines did not show sit, when two options were found: the popup's options are evenly spaced, so a
/// missing one is at the pitch of the two found. Fewer than two found fix no pitch, and three leave nothing missing.
pub fn missing_options(found: &[(Difficulty, Region)]) -> Vec<(Difficulty, Region)> {
    let [(first, first_region), (second, second_region)] = found else {
        return Vec::new();
    };
    let steps = position(*second) - position(*first);
    let pitch = (i64::from(second_region.y) - i64::from(first_region.y)) / steps;
    DIFFICULTIES
        .into_iter()
        .filter(|difficulty| difficulty != first && difficulty != second)
        .filter_map(|difficulty| {
            let y = i64::from(first_region.y) + pitch * (position(difficulty) - position(*first));
            Some((
                difficulty,
                Region {
                    y: u32::try_from(y).ok()?,
                    ..*first_region
                },
            ))
        })
        .collect()
}

/// What the lines of the Party panel's area show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PartyAnchors {
    /// Whether a line reads as the panel's title (the whole word or a prefix of it, as `party_panel_open` decides).
    pub open: bool,
    /// The "Game Name" label.
    pub label: Option<Region>,
    /// The line just under the label, which holds the game name when the eye icon revealed it.
    pub field: Option<Region>,
}

/// The Party panel in the lines of its area: the title line, the "Game Name" label line, and the line just below the label
/// that horizontally overlaps it (the field's box), within the field's distance. The "Password" label and a second label
/// are never the field.
pub fn find_party(pack: &LanguagePack, lines: &[TextLine], frame_height: u32) -> PartyAnchors {
    let sorted = top_down(lines);
    let open = sorted.iter().any(|line| pack.party_panel_open(&line.text));
    let label = sorted
        .iter()
        .find(|line| {
            pack.is_word(&line.text, GAME_NAME) || pack.is_squashed_word(&line.text, GAME_NAME)
        })
        .copied();
    let field = label.and_then(|label| {
        sorted
            .iter()
            .find(|line| {
                let apart = line
                    .region
                    .middle_y()
                    .saturating_sub(label.region.middle_y());
                apart > 0
                    && apart <= field_gap(frame_height)
                    && line.region.x < label.region.right() + scaled(30, frame_height)
                    && line.region.right() + scaled(30, frame_height) > label.region.x
                    && !pack.is_word(&line.text, PASSWORD)
                    && !pack.is_squashed_word(&line.text, PASSWORD)
            })
            .map(|line| line.region)
    });
    PartyAnchors {
        open,
        label: label.map(|label| label.region),
        field,
    }
}

/// Where the field's box sits when no line was found under the label (a masked field has no text the engine reads): the
/// box under the label, as wide as the reference field. Reading it gives the blank that means masked.
pub fn field_below(label: Region, frame_height: u32) -> Region {
    Region {
        x: label.x.saturating_sub(scaled(30, frame_height)),
        y: label.bottom(),
        width: scaled(156, frame_height),
        height: scaled(38, frame_height),
    }
}

/// `region` grown by `pad` pixels on every side, kept inside a frame of `width` × `height`. A tight line box clips the
/// strokes of the glyphs; the rows of the game's lists are far enough apart for a few pixels.
pub fn padded(region: Region, pad: u32, width: u32, height: u32) -> Region {
    let x = region.x.saturating_sub(pad);
    let y = region.y.saturating_sub(pad);
    let right = region.right().saturating_add(pad).min(width);
    let bottom = region.bottom().saturating_add(pad).min(height);
    Region {
        x,
        y,
        width: right.saturating_sub(x),
        height: bottom.saturating_sub(y),
    }
}

/// The padding of a line's box, in pixels of a client `height` px high: 3 px on the reference client, never less than 2.
pub fn line_pad(frame_height: u32) -> u32 {
    scaled(3, frame_height).max(2)
}

#[cfg(test)]
mod tests {
    use super::{
        CardAnchor, field_below, find_cards, find_party, line_pad, missing_options, padded,
        popup_options,
    };
    use crate::characters::Difficulty;
    use crate::language::LanguagePack;
    use crate::vision::{Region, TextLine};

    /// A line of text centred on `y`, 16 px high, from `x` to `x + width`.
    fn line(text: &str, x: u32, y: u32, width: u32) -> TextLine {
        TextLine {
            text: text.to_string(),
            region: Region {
                x,
                y: y - 8,
                width,
                height: 16,
            },
        }
    }

    fn column(text: &str, y: u32) -> TextLine {
        line(text, 1560, y, 220)
    }

    fn pack() -> LanguagePack {
        LanguagePack::english()
    }

    fn centre(region: Region) -> u32 {
        region.middle_y()
    }

    /// The right column of the maintainer's full-screen 1920×1080 print: the tabs, a titled card, an untitled card.
    fn full_screen_column() -> Vec<TextLine> {
        vec![
            column("ONLINE OFFLINE", 53),
            column("MATRIARCH", 87),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
            column("vukaDao", 210),
            column("Level 11 Sorceress", 233),
        ]
    }

    /// The same list on the 1920×1033 reference client (a title region at 61, names at 91 and 181).
    fn reference_column() -> Vec<TextLine> {
        vec![
            column("MATRIARCH", 61),
            column("vukVuka", 91),
            column("Level 88 Sorceress", 113),
            column("vukaDao", 181),
            column("Level 11 Sorceress", 203),
        ]
    }

    fn rows(cards: &[CardAnchor]) -> Vec<(Option<u32>, u32, u32)> {
        cards
            .iter()
            .map(|card| {
                (
                    card.title.known().map(centre),
                    centre(card.name),
                    centre(card.level),
                )
            })
            .collect()
    }

    #[test]
    fn the_cards_of_a_full_screen_client_are_found_by_their_level_lines() {
        let cards = find_cards(&pack(), &full_screen_column(), 1080);
        assert_eq!(
            rows(&cards),
            [(Some(87), 118, 141), (None, 210, 233)],
            "the title is the line above the name, the second card has none"
        );
    }

    #[test]
    fn the_cards_of_the_reference_client_are_found_the_same_way() {
        let cards = find_cards(&pack(), &reference_column(), 1033);
        assert_eq!(rows(&cards), [(Some(61), 91, 113), (None, 181, 203)]);
    }

    #[test]
    fn the_tab_line_over_an_untitled_first_card_is_not_a_title() {
        let lines = vec![
            column("ONLINE OFFLINE", 53),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
        ];
        let cards = find_cards(&pack(), &lines, 1080);
        assert_eq!(rows(&cards), [(None, 118, 141)]);
        // Even a tab that sits within a card's height of the name is not a title.
        let close = vec![
            column("ONLINE OFFLINE", 96),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
        ];
        assert_eq!(rows(&find_cards(&pack(), &close, 1080)), [(None, 118, 141)]);
    }

    #[test]
    fn a_line_above_the_name_that_is_no_known_title_is_an_unknown_title() {
        let lines = vec![
            column("Marshal", 87),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
        ];
        let cards = find_cards(&pack(), &lines, 1080);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].title, super::TitleLine::Unknown);
        // A line farther than a card's height above the name is no title line at all.
        let far = vec![
            column("Marshal", 40),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
        ];
        assert_eq!(
            find_cards(&pack(), &far, 1080)[0].title,
            super::TitleLine::None
        );
    }

    #[test]
    fn the_previous_cards_level_line_right_above_a_name_is_no_title() {
        let lines = vec![
            column("Level 88 Sorceress", 100),
            column("vukaDao", 130),
            column("Level 11 Sorceress", 153),
        ];
        let cards = find_cards(&pack(), &lines, 1080);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].title, super::TitleLine::None);
    }

    #[test]
    fn a_missing_level_line_yields_no_card() {
        let lines = vec![
            column("MATRIARCH", 87),
            column("vukVuka", 118),
            column("vukaDao", 210),
            column("Level 11 Sorceress", 233),
        ];
        let cards = find_cards(&pack(), &lines, 1080);
        assert_eq!(
            rows(&cards),
            [(None, 210, 233)],
            "only the card with its level line"
        );
        assert!(find_cards(&pack(), &lines[..2], 1080).is_empty());
    }

    #[test]
    fn a_level_line_far_from_any_line_above_has_no_name_and_yields_no_card() {
        let lines = vec![column("vukVuka", 100), column("Level 88 Sorceress", 160)];
        assert!(
            find_cards(&pack(), &lines, 1080).is_empty(),
            "60 px is another card"
        );
        let alone = vec![column("Level 88 Sorceress", 160)];
        assert!(find_cards(&pack(), &alone, 1080).is_empty());
    }

    #[test]
    fn the_previous_cards_level_line_is_not_the_next_cards_name() {
        // The second card's name was not read: the line above its level line is the first card's level line, 92 px up.
        let lines = vec![
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
            column("Level 11 Sorceress", 233),
        ];
        assert_eq!(rows(&find_cards(&pack(), &lines, 1080)), [(None, 118, 141)]);
        // Close enough to be within the gap, still a level line and not a name.
        let adjacent = vec![
            column("Level 88 Sorceress", 141),
            column("Level 11 Sorceress", 170),
        ];
        assert!(find_cards(&pack(), &adjacent, 1080).is_empty());
    }

    #[test]
    fn the_lines_are_taken_top_down_whatever_their_order() {
        let mut lines = full_screen_column();
        lines.reverse();
        assert_eq!(
            rows(&find_cards(&pack(), &lines, 1080)),
            [(Some(87), 118, 141), (None, 210, 233)]
        );
    }

    /// The Select Difficulty popup of the full-screen print: the title and the three options.
    fn popup(title: u32, normal: u32, nightmare: u32, hell: u32) -> Vec<TextLine> {
        let centred = |text: &str, y| line(text, 860, y, 200);
        vec![
            centred("SELECT DIFFICULTY", title),
            centred("NORMAL", normal),
            centred("NIGHTMARE", nightmare),
            centred("HELL", hell),
        ]
    }

    #[test]
    fn the_popup_options_are_found_by_their_word_in_both_geometries() {
        for lines in [popup(385, 455, 521, 586), popup(353, 422, 486, 550)] {
            let found = popup_options(&pack(), &lines);
            let difficulties: Vec<Difficulty> = found.iter().map(|(d, _)| *d).collect();
            assert_eq!(
                difficulties,
                [Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell]
            );
            assert!(missing_options(&found).is_empty());
        }
        let found = popup_options(&pack(), &popup(385, 455, 521, 586));
        assert_eq!(centre(found[2].1), 586);
    }

    #[test]
    fn an_option_the_lines_missed_is_placed_at_the_pitch_of_the_other_two() {
        let mut lines = popup(385, 455, 521, 586);
        lines.remove(1);
        let missing = missing_options(&popup_options(&pack(), &lines));
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].0, Difficulty::Normal);
        assert_eq!(centre(missing[0].1), 456, "the pitch is 65 px: 521 - 65");
        let mut lines = popup(385, 455, 521, 586);
        lines.remove(2);
        let missing = missing_options(&popup_options(&pack(), &lines));
        assert_eq!(missing[0].0, Difficulty::Nightmare);
        assert_eq!(missing[0].1.y, (455 - 8 + 586 - 8) / 2);
        let mut lines = popup(385, 455, 521, 586);
        lines.remove(3);
        let missing = missing_options(&popup_options(&pack(), &lines));
        assert_eq!(missing[0].0, Difficulty::Hell);
        assert_eq!(centre(missing[0].1), 587, "the pitch is 66 px: 521 + 66");
    }

    #[test]
    fn one_option_found_fixes_no_pitch() {
        let lines = popup(385, 455, 521, 586);
        let found = popup_options(&pack(), &lines[1..2]);
        assert_eq!(found.len(), 1);
        assert!(missing_options(&found).is_empty());
        assert!(missing_options(&[]).is_empty());
    }

    /// The Party panel of the full-screen print: the title, the label, the revealed game name and the password label.
    fn party(title: u32, label: u32, field: Option<u32>, password: u32) -> Vec<TextLine> {
        let mut lines = vec![
            line("PARTY", 350, title, 70),
            line("GAME NAME", 280, label, 90),
            line("PASSWORD", 285, password, 80),
        ];
        if let Some(y) = field {
            lines.push(line("MF-FAST-RUN-O1", 255, y, 140));
        }
        lines
    }

    #[test]
    fn the_game_name_is_the_line_just_under_its_label_in_both_geometries() {
        for (lines, height, field) in [
            (party(153, 192, Some(220), 262), 1080, 220),
            (party(146, 183, Some(210), 250), 1033, 210),
        ] {
            let found = find_party(&pack(), &lines, height);
            assert!(found.open);
            assert_eq!(
                found.label.map(centre),
                lines.get(1).map(|l| centre(l.region))
            );
            assert_eq!(found.field.map(centre), Some(field));
        }
    }

    #[test]
    fn a_masked_field_has_no_line_and_the_password_label_is_never_the_field() {
        let lines = party(153, 192, None, 240);
        let found = find_party(&pack(), &lines, 1080);
        assert!(found.open);
        assert!(found.label.is_some());
        assert_eq!(
            found.field, None,
            "the password label 48 px under is not the game name"
        );
        let label = found.label.expect("the label");
        let below = field_below(label, 1080);
        assert_eq!(below.y, label.bottom());
        assert_eq!(below.width, 163);
        assert_eq!(below.height, 40);
        assert_eq!(below.x, label.x - 31);
    }

    #[test]
    fn a_closed_panel_or_a_missing_label_finds_what_it_finds() {
        let lines = vec![line("MF-FAST-RUN-O1", 255, 220, 140)];
        let found = find_party(&pack(), &lines, 1080);
        assert!(!found.open);
        assert_eq!(found.label, None);
        assert_eq!(
            found.field, None,
            "a line with no label above it is not a field"
        );
        let tooltip = vec![line("PAR", 350, 153, 40)];
        assert!(
            find_party(&pack(), &tooltip, 1080).open,
            "a prefix of the title"
        );
    }

    #[test]
    fn a_line_under_the_label_but_far_to_the_side_or_too_low_is_not_the_field() {
        let side = vec![
            line("GAME NAME", 280, 192, 90),
            line("MF-FAST-RUN-O1", 900, 220, 140),
        ];
        assert_eq!(find_party(&pack(), &side, 1080).field, None);
        let low = vec![
            line("GAME NAME", 280, 192, 90),
            line("MF-FAST-RUN-O1", 255, 260, 140),
        ];
        assert_eq!(find_party(&pack(), &low, 1080).field, None, "68 px under");
    }

    #[test]
    fn a_card_found_in_any_variant_is_merged_by_its_level_line_and_a_known_title_wins() {
        use super::{TitleLine, find_cards_in_variants};
        let garbled = vec![
            column("QZXWVKJ", 87),
            column("vukVuka", 118),
            column("Level 88 Sorceress", 141),
        ];
        let nothing = vec![column("vukVuka", 119)];
        let clean = vec![
            column("MATRIARCH", 87),
            column("vukVuka", 120),
            column("Level 88 Sorceress", 143),
        ];
        let cards = find_cards_in_variants(&pack(), &[garbled.clone(), nothing, clean], 1080);
        assert_eq!(cards.len(), 1, "one card, its level lines overlap");
        assert!(matches!(cards[0].title, TitleLine::Known(_)));
        // The card is found from a later variant alone, and a garbled title alone refuses.
        let only_later = find_cards_in_variants(&pack(), &[vec![], garbled], 1080);
        assert_eq!(only_later.len(), 1);
        assert_eq!(only_later[0].title, TitleLine::Unknown);
        // Two cards of two variants stay two, top to bottom.
        let two = find_cards_in_variants(
            &pack(),
            &[full_screen_column()[3..].to_vec(), full_screen_column()],
            1080,
        );
        assert_eq!(two.len(), 2);
        assert!(centre(two[0].level) < centre(two[1].level));
    }

    #[test]
    fn a_popup_option_or_label_found_in_one_variant_counts() {
        use super::{find_party_in_variants, popup_options_in_variants, popup_title_in_variants};
        let full = popup(385, 455, 521, 586);
        let found =
            popup_options_in_variants(&pack(), &[full[2..3].to_vec(), vec![], full[1..2].to_vec()]);
        let words: Vec<Difficulty> = found.iter().map(|(d, _)| *d).collect();
        assert_eq!(words, [Difficulty::Normal, Difficulty::Nightmare]);
        assert!(popup_title_in_variants(
            &pack(),
            &[vec![], full[..1].to_vec()]
        ));
        let panel = party(153, 192, Some(220), 262);
        let label_only: Vec<TextLine> = panel[1..2].to_vec();
        let found = find_party_in_variants(
            &pack(),
            &[panel[..1].to_vec(), label_only, panel.clone()],
            1080,
        );
        assert!(found.open && found.label.is_some());
        assert_eq!(
            found.field.map(centre),
            Some(220),
            "the label and field of the first variant that has both"
        );
    }

    #[test]
    fn the_tab_strip_is_told_from_a_card_line() {
        use super::is_tab_line;
        for tab in ["ONLINE OFFLINE", "Online", "OFFLINE", "O NLINE OFFLINE"] {
            assert!(is_tab_line(&pack(), tab), "{tab}");
        }
        for other in ["vukVuka", "Level 88 Sorceress", "MATRIARCH", ""] {
            assert!(!is_tab_line(&pack(), other), "{other}");
        }
    }

    #[test]
    fn the_party_area_holds_the_title_label_and_field_of_both_clients() {
        use crate::layout::{PanelRegion, panel_region};
        for (height, title, label, field) in [(1080, 153, 192, 220), (1033, 146, 183, 210)] {
            let area = panel_region(PanelRegion::PartyPanel, 1920, height).expect("resolves");
            for (x, y) in [(400, title), (320, label), (255, field), (395, field)] {
                assert!(
                    area.x <= x && x < area.right() && area.y <= y && y < area.bottom(),
                    "({x}, {y}) is in the party area at {height}"
                );
            }
        }
    }

    #[test]
    fn padding_stays_inside_the_frame() {
        let region = Region {
            x: 1,
            y: 1,
            width: 10,
            height: 10,
        };
        assert_eq!(
            padded(region, 3, 20, 20),
            Region {
                x: 0,
                y: 0,
                width: 14,
                height: 14
            }
        );
        assert_eq!(padded(region, 3, 8, 8).width, 8);
        assert_eq!(line_pad(1033), 3);
        assert_eq!(line_pad(1080), 3);
        assert_eq!(line_pad(300), 2, "never under 2 px");
    }
}
