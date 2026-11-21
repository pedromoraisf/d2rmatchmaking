//! What a reading of a variation of a screenshot amounts to: read correctly, refused (the agent said it could not read
//! it: it posts nothing) or read WRONG (a false read, the worst outcome: the agent would act on text that is not there).
//! The rules are pure functions over a reading, tested without OCR; `classify_image` runs the production reading and applies
//! them. Reasons are short classes that name no character name and no game name.
use std::borrow::Cow;

use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::party::read_panel;
use d2rmm_agent_core::ports::{FrameReader, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::anchors;
use d2rmm_agent_domain::characters::{Card as Character, Difficulty};
use d2rmm_agent_domain::game_name_match::{
    FieldRead, FieldSource, is_masked, normalise, read_field, read_panel_field,
};
use d2rmm_agent_domain::layout::supported_size;
#[cfg(test)]
use d2rmm_agent_domain::name_diff::printable;
use d2rmm_agent_domain::name_diff::{edit_distance, edit_operations, edit_operations_with};
use d2rmm_agent_domain::presence::Screen;

use d2rmm_agent_domain::vision::TextLine;

use crate::ocr_check::{
    Card, ChatClass, ChatExpectation, ChatReading, MAINTAINER_CARDS, PARTY_ROOM_NAME,
    automap_expectation, chat_expectation, is_generated_game_name, party_expectation, read_automap,
    read_chat,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Correct,
    Refused,
    Wrong,
}

impl Outcome {
    pub fn name(self) -> &'static str {
        match self {
            Outcome::Correct => "correct",
            Outcome::Refused => "refused",
            Outcome::Wrong => "wrong",
        }
    }
}

/// An outcome and the class of reason behind it: fixed words, field names and numbers, never text read from the screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub outcome: Outcome,
    pub reason: Cow<'static, str>,
}

const fn verdict(outcome: Outcome, reason: &'static str) -> Verdict {
    Verdict {
        outcome,
        reason: Cow::Borrowed(reason),
    }
}

fn verdict_owned(outcome: Outcome, reason: String) -> Verdict {
    Verdict {
        outcome,
        reason: Cow::Owned(reason),
    }
}

/// The verdict of an image whose size the layout does not support.
pub const UNSUPPORTED_SIZE: Verdict = verdict(Outcome::Refused, "unsupported-size");

/// A character of a read as it may be printed in a reason: `[a-z0-9 -]` as is. Any other ASCII character (a letter of a
/// generated name read as punctuation, `sub(U+F07E>o)@5`) becomes the private-use character `U+F000` plus its code, so that
/// `codepoints` prints which ASCII glyph it was (`U+F07E` is `~`) without a bracket or comma of the operation syntax being
/// mistaken for one. A character outside ASCII (an engine's stand-in for a glyph it did not know) stays as it is here and
/// `codepoints` turns it into its `U+XXXX`. Used only against a generated game name or the public Party room name, never in a chat reason.
fn field_glyph(c: char) -> char {
    if c.is_ascii_lowercase() || c.is_ascii_digit() || c == ' ' || c == '-' {
        c
    } else if c.is_ascii() {
        char::from_u32(0xF000 + u32::from(c)).unwrap_or('?')
    } else {
        c
    }
}

/// `text` with each character outside ASCII written as its code point (`U+00E9`).
fn codepoints(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii() {
                c.to_string()
            } else {
                format!("U+{:04X}", u32::from(c))
            }
        })
        .collect()
}

fn without_whitespace(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Why a field that showed another name is not the expected one: how close the closest of its readings is. For one or two
/// edits against the public Party room name, the operations are appended (`field-other-1-edit:sub(o>0)@9`).
fn other_reason(reads: &[&str], expected_name: &str) -> Cow<'static, str> {
    let expected = normalise(expected_name);
    let closest = reads
        .iter()
        .filter(|read| !read.trim().is_empty())
        .map(|read| normalise(read))
        .map(|read| {
            let distance = if without_whitespace(&read) == without_whitespace(&expected) {
                0
            } else {
                edit_distance(&read, &expected).max(1)
            };
            (distance, read)
        })
        .min_by_key(|(distance, _)| *distance);
    let Some((distance, read)) = closest else {
        return Cow::Borrowed("field-other-blank");
    };
    let class = match distance {
        0 => return Cow::Borrowed("field-other-spacing"),
        1 => "field-other-1-edit",
        2 => "field-other-2-edits",
        _ => return Cow::Borrowed("field-other-far"),
    };
    if expected_name == PARTY_ROOM_NAME || is_generated_game_name(expected_name) {
        Cow::Owned(format!(
            "{class}:{}",
            codepoints(&edit_operations_with(&read, &expected, field_glyph).join(","))
        ))
    } else {
        Cow::Borrowed(class)
    }
}

/// A Party frame: `open` is whether the panel was found, `reads` the readings of the Game Name field. The agent treats a
/// blank or `x`-only field as masked and only asks the player to reveal the name, so a masked read where the name is shown
/// is Refused; the worst outcome is a name read where the field is masked.
pub fn classify_party(
    open: bool,
    reads: &[&str],
    expected_name: &str,
    expected: FieldRead,
) -> Verdict {
    classify_party_field(open, FieldSource::Label, reads, expected_name, expected)
}

/// `classify_party` for a field read from `source`. When no variant found the label (`LayoutBox`), the agent only accepts an
/// exact match or the mask itself (`read_panel_field`): a match is Correct (`label-not-found-layout-match`), a match where
/// the field is masked is Wrong, the mask read where the field is masked is Correct (`label-not-found-layout-mask`), the
/// mask read where the name is shown is Refused (`label-not-found-layout-mask-for-revealed`: the player is asked to
/// reveal, nothing is posted), and anything else is Refused (`label-not-found-layout-other`). `blank-read-as-masked` is
/// therefore only a label-found reason.
pub fn classify_party_field(
    open: bool,
    source: FieldSource,
    reads: &[&str],
    expected_name: &str,
    expected: FieldRead,
) -> Verdict {
    if !open {
        return verdict(Outcome::Refused, "panel-not-open");
    }
    let got = read_panel_field(source, reads, expected_name);
    if source == FieldSource::LayoutBox {
        return match (got, expected) {
            (FieldRead::Matched, FieldRead::Matched) => {
                verdict(Outcome::Correct, "label-not-found-layout-match")
            }
            (FieldRead::Matched, _) => verdict(Outcome::Wrong, "matched-read-for-masked"),
            (FieldRead::Masked, FieldRead::Masked) => {
                verdict(Outcome::Correct, "label-not-found-layout-mask")
            }
            (FieldRead::Masked, _) => {
                verdict(Outcome::Refused, "label-not-found-layout-mask-for-revealed")
            }
            _ => verdict(Outcome::Refused, "label-not-found-layout-other"),
        };
    }
    match (got, expected) {
        (got, expected) if got == expected => verdict(Outcome::Correct, "field-as-expected"),
        (FieldRead::Masked, FieldRead::Matched) => {
            if reads.iter().any(|read| is_masked(read)) {
                verdict(Outcome::Refused, "mask-read-for-revealed")
            } else {
                verdict(Outcome::Refused, "blank-read-as-masked")
            }
        }
        (FieldRead::Matched, FieldRead::Masked) => {
            verdict(Outcome::Wrong, "matched-read-for-masked")
        }
        _ => Verdict {
            outcome: Outcome::Refused,
            reason: other_reason(reads, expected_name),
        },
    }
}

/// The selection screen: each card read is matched to the expected card with the same name (without case), not by its
/// position: the agent picks the selected card by its gold frame, so a card the screen shows first but the reader missed
/// is a missing card, not a wrong one. A card with an expected name and another class, level or title is Wrong
/// (`card{expected}-{fields}`); a card whose name is none of the expected ones is Wrong (`card{slot}-name=other:{edits}`),
/// or `extra-card` when the screen has no such slot; an expected card never read is Refused.
pub fn classify_select(reading: &FrameReading, cards: &[Card]) -> Verdict {
    if reading.screen != Screen::CharacterSelect {
        return verdict(Outcome::Refused, "not-the-select-screen");
    }
    let mut matched = vec![false; cards.len()];
    for (slot, card) in reading.cards.iter().enumerate() {
        let read_name = card.name().to_lowercase();
        let expected = cards
            .iter()
            .position(|(name, ..)| name.to_lowercase() == read_name);
        let Some(index) = expected else {
            if slot >= cards.len() {
                return verdict(Outcome::Wrong, "extra-card");
            }
            let fields = differing_fields(card, cards[slot], Some(name_edits(&read_name, cards)));
            return verdict_owned(Outcome::Wrong, format!("card{slot}-{}", fields.join("+")));
        };
        matched[index] = true;
        let fields = differing_fields(card, cards[index], None);
        if !fields.is_empty() {
            return verdict_owned(Outcome::Wrong, format!("card{index}-{}", fields.join("+")));
        }
    }
    if matched.contains(&false) {
        return verdict_owned(Outcome::Refused, cards_refused_reason(reading, cards.len()));
    }
    verdict(Outcome::Correct, "cards-as-expected")
}

/// `name=other:{operations}`: the edits that turn the read name into the closest expected one. Characters outside
/// `[a-z0-9]` print as `?`; the expected names are public (`ocr_check`).
fn name_edits(read_name: &str, cards: &[Card]) -> String {
    let closest = cards
        .iter()
        .map(|(name, ..)| name.to_lowercase())
        .min_by_key(|name| edit_distance(read_name, name))
        .unwrap_or_default();
    format!(
        "name=other:{}",
        edit_operations(read_name, &closest).join(",")
    )
}

/// The fields of a card read that differ from the expected one, each with the value read: a title, a class and a level are
/// game vocabulary. `name` is the name field already worded (a card whose name matched no expected one), or none when the
/// name matched.
fn differing_fields(card: &Character, expected: Card, name: Option<String>) -> Vec<String> {
    let (_, class, level, title) = expected;
    let mut fields: Vec<String> = name.into_iter().collect();
    if card.class() != class {
        fields.push(format!("class={:?}", card.class()));
    }
    if card.level() != level {
        fields.push(format!("level={}", card.level()));
    }
    if card.title() != title {
        fields.push(match card.title() {
            Some(read) => format!("title={read:?}"),
            None => "title=None".to_string(),
        });
    }
    fields
}

/// `cards-refused-{read}of{expected}-slots{n}` and the rejection kinds (sorted, joined by `+`) when some slot was refused.
fn cards_refused_reason(reading: &FrameReading, expected: usize) -> String {
    let mut kinds: Vec<&str> = reading.rejected.iter().map(|r| r.reason.code()).collect();
    kinds.sort_unstable();
    kinds.dedup();
    let mut reason = format!(
        "cards-refused-{}of{expected}-slots{}",
        reading.cards.len(),
        reading.slots_read
    );
    if !kinds.is_empty() {
        reason.push('-');
        reason.push_str(&kinds.join("+"));
    }
    reason
}

/// The difficulty popup: the selection screen's rules, then the first card's unlocked difficulties, which must be Normal,
/// Nightmare and Hell. Another non-empty set is Wrong; none read is Refused.
pub fn classify_popup(reading: &FrameReading, cards: &[Card]) -> Verdict {
    let cards_verdict = classify_select(reading, cards);
    if cards_verdict.outcome != Outcome::Correct {
        if cards_verdict.reason.starts_with("cards-refused") {
            let reason = format!("{}-options{}", cards_verdict.reason, reading.popup_options);
            return verdict_owned(Outcome::Refused, reason);
        }
        return cards_verdict;
    }
    let read = reading
        .cards
        .first()
        .map(|card| card.unlocked_difficulties())
        .unwrap_or_default();
    if read.is_empty() {
        verdict(Outcome::Refused, "no-difficulties")
    } else if read == [Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell] {
        verdict(Outcome::Correct, "difficulties-as-expected")
    } else {
        let names: Vec<&str> = read
            .iter()
            .map(|difficulty| match difficulty {
                Difficulty::Normal => "normal",
                Difficulty::Nightmare => "nightmare",
                Difficulty::Hell => "hell",
            })
            .collect();
        verdict_owned(Outcome::Wrong, format!("difficulties-{}", names.join("+")))
    }
}

/// Reads `image` as the production check does for the screenshot called `name` and classifies the result. A file the check
/// does not know is refused; an unsupported size is refused before any reading.
pub fn classify_image(
    name: &str,
    reader: &dyn TextReader,
    screens: &ScreenReader,
    image: &Rgba,
) -> Verdict {
    classify_image_detailed(name, reader, screens, image).0
}

/// The automap's name line (GNR-11): Correct when some line of some variant reads as the expected generated name by the
/// production match; otherwise Refused, with the class of how close the closest line is (`automap-other-1-edit:sub(o>0)@9`,
/// the operations being against the generated name, which is public), or `automap-no-lines` when the band read no line. The
/// agent only accepts an exact match, so a refused read is never Wrong.
pub fn classify_automap(variants: &[Vec<TextLine>], expected_name: &str) -> Verdict {
    let texts: Vec<&str> = variants
        .iter()
        .flatten()
        .map(|line| line.text.as_str())
        .collect();
    if texts.is_empty() {
        return verdict(Outcome::Refused, "automap-no-lines");
    }
    // The agent's own rule: the name line of a variant is found by its shape, whole or after the label (`find_name_line`), and
    // only then matched; a read of the whole line that matches is correct as before.
    let by_the_agents_rule = anchors::find_name_line_in_variants(variants)
        .iter()
        .any(|named| read_field(&named.text, expected_name) == FieldRead::Matched);
    if by_the_agents_rule
        || texts
            .iter()
            .any(|text| read_field(text, expected_name) == FieldRead::Matched)
    {
        return verdict(Outcome::Correct, "name-line-as-expected");
    }
    let reason = other_reason(&texts, expected_name).replacen("field-", "automap-", 1);
    verdict_owned(Outcome::Refused, reason)
}

/// A chat print (GNR-11): Correct when exactly one class (joined or left) is found among the candidates of the print's
/// language, equal to the expected one when the file names it, with a name read before the phrase
/// (`chat-event-as-expected`, or `chat-event-found` when the file names no class). The other class found is Wrong
/// (`chat-event-left-for-joined`); no phrase, both classes (unless the file names no class, then `chat-event-found-both`) and a missing name are Refused. Reasons are fixed words.
pub fn classify_chat(reading: &ChatReading, expected: ChatExpectation) -> Verdict {
    let found = match reading.class_for(expected.language) {
        Ok(class) => class,
        // A print whose file names no event may hold both a joined and a left line: the rule `check_chat_reading` applies.
        Err("both") if expected.class.is_none() => {
            return if reading.name_read {
                verdict(Outcome::Correct, "chat-event-found-both")
            } else {
                verdict(Outcome::Refused, "chat-no-name")
            };
        }
        Err("both") => return verdict(Outcome::Refused, "chat-both-classes"),
        Err(_) if reading.lines_per_variant.iter().sum::<usize>() == 0 => {
            return verdict(Outcome::Refused, "chat-no-lines");
        }
        Err(_) => {
            return match reading
                .near_phrase
                .iter()
                .find(|(language, _)| *language == expected.language)
            {
                Some((_, ops)) => verdict_owned(Outcome::Refused, format!("chat-no-phrase:{ops}")),
                None => verdict(Outcome::Refused, "chat-no-phrase"),
            };
        }
    };
    match (expected.class, found) {
        (Some(ChatClass::Joined), ChatClass::Left) => {
            verdict(Outcome::Wrong, "chat-event-left-for-joined")
        }
        (Some(ChatClass::Left), ChatClass::Joined) => {
            verdict(Outcome::Wrong, "chat-event-joined-for-left")
        }
        _ if !reading.name_read => verdict(Outcome::Refused, "chat-no-name"),
        (Some(_), _) => verdict(Outcome::Correct, "chat-event-as-expected"),
        (None, _) => verdict(Outcome::Correct, "chat-event-found"),
    }
}

/// The class of each OCR variant's reading of the Party field, in reader order (nearest 3x, bilinear 3x, nearest 4x,
/// bilinear 4x, nearest 5x, bilinear 5x): `match`, `masked`, `blank`, `1-edit`, `2-edits` or `far` against the expected name.
/// Only the class is kept; a variant that failed in the engine is left out by the reader, so the list may be shorter.
pub fn field_variant_classes(reads: &[&str], expected_name: &str) -> Vec<&'static str> {
    let expected = normalise(expected_name);
    reads
        .iter()
        .map(|read| {
            if read.trim().is_empty() {
                "blank"
            } else if is_masked(read) {
                "masked"
            } else {
                match edit_distance(&normalise(read), &expected) {
                    0 => "match",
                    1 => "1-edit",
                    2 => "2-edits",
                    _ => "far",
                }
            }
        })
        .collect()
}

/// `classify_image`, and for a Party frame the class of each OCR variant's reading of the field (`None` for other screens).
pub fn classify_image_detailed(
    name: &str,
    reader: &dyn TextReader,
    screens: &ScreenReader,
    image: &Rgba,
) -> (Verdict, Option<Vec<&'static str>>) {
    if !supported_size(image.width, image.height) {
        return (UNSUPPORTED_SIZE, None);
    }
    if let Some((expected_name, expected)) = party_expectation(name) {
        let (verdict, variants) = classify_party_image(reader, image, expected_name, expected);
        return (verdict, Some(variants));
    }
    if let Some(expected_name) = automap_expectation(name) {
        return (
            classify_automap(&read_automap(reader, image), expected_name),
            None,
        );
    }
    if let Some(expected) = chat_expectation(name) {
        return (classify_chat(&read_chat(reader, image), expected), None);
    }
    match name {
        "maintainer-select-screen.png" => (
            classify_select(&screens.read(image), &MAINTAINER_CARDS),
            None,
        ),
        "maintainer-select-difficulty.png" => (
            classify_popup(&screens.read(image), &MAINTAINER_CARDS),
            None,
        ),
        _ => (verdict(Outcome::Refused, "unknown-screenshot"), None),
    }
}

fn classify_party_image(
    reader: &dyn TextReader,
    image: &Rgba,
    expected_name: &str,
    expected: FieldRead,
) -> (Verdict, Vec<&'static str>) {
    let panel = read_panel(reader, &crate::language_pack::shipped(), image);
    let field: Vec<&str> = panel.field.iter().map(|read| read.text.as_str()).collect();
    (
        classify_party_field(
            panel.open,
            panel.field_source,
            &field,
            expected_name,
            expected,
        ),
        field_variant_classes(&field, expected_name),
    )
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::messages::FrameReading;
    use d2rmm_agent_domain::characters::{Card as Character, Class, Mode, Title};
    use d2rmm_agent_domain::language::LanguagePack;

    use super::*;

    fn reading(screen: Screen, cards: Vec<Character>) -> FrameReading {
        FrameReading {
            screen,
            slots_read: 0,
            popup_options: 0,
            rejected: Vec::new(),
            cards,
        }
    }

    fn card(name: &str, class: Class, level: u8, title: Option<Title>) -> Character {
        Character::new(name, class, level, Mode::Softcore, title).unwrap()
    }

    fn expected_cards() -> Vec<Character> {
        vec![
            card("vukVuka", Class::Sorceress, 88, Some(Title::Matriarch)),
            card("vukaDao", Class::Sorceress, 11, None),
        ]
    }

    fn party(reads: &[&str], expected: FieldRead) -> Verdict {
        classify_party(true, reads, PARTY_ROOM_NAME, expected)
    }

    #[test]
    fn a_party_frame_expecting_matched() {
        let check = |reads: &[&str]| party(reads, FieldRead::Matched);
        assert_eq!(
            check(&["noise", "DUEL NK LOCKS"]),
            verdict(Outcome::Correct, "field-as-expected")
        );
        assert_eq!(
            classify_party(
                false,
                &["DUEL NK LOCKS"],
                PARTY_ROOM_NAME,
                FieldRead::Matched
            ),
            verdict(Outcome::Refused, "panel-not-open")
        );
    }

    #[test]
    fn a_field_read_in_the_layout_box_reads_as_masked_only_when_the_mask_is_read() {
        let layout = |reads: &[&str], expected| {
            classify_party_field(
                true,
                FieldSource::LayoutBox,
                reads,
                PARTY_ROOM_NAME,
                expected,
            )
        };
        assert_eq!(
            layout(&["", "DUEL NK LOCKS"], FieldRead::Matched),
            verdict(Outcome::Correct, "label-not-found-layout-match")
        );
        for reads in [&["", " "][..], &["other"], &[]] {
            assert_eq!(
                layout(reads, FieldRead::Matched),
                verdict(Outcome::Refused, "label-not-found-layout-other"),
                "{reads:?}"
            );
        }
        assert_eq!(
            layout(&["DUEL NK LOCKS"], FieldRead::Masked),
            verdict(Outcome::Wrong, "matched-read-for-masked")
        );
        assert_eq!(
            layout(&[""], FieldRead::Masked),
            verdict(Outcome::Refused, "label-not-found-layout-other"),
            "a blank box is not the mask"
        );
        assert_eq!(
            layout(&["", "xxxxxxxx"], FieldRead::Masked),
            verdict(Outcome::Correct, "label-not-found-layout-mask")
        );
        assert_eq!(
            layout(&["xxxxxxxx"], FieldRead::Matched),
            verdict(Outcome::Refused, "label-not-found-layout-mask-for-revealed")
        );
    }

    /// A deliberate re-classification: a masked read where the name is shown was Wrong, now Refused, because the agent
    /// treats a blank or x-only field as masked and only asks the player to reveal the name; nothing is posted.
    #[test]
    fn a_masked_read_for_a_revealed_name_is_refused_with_its_reason() {
        let check = |reads: &[&str]| party(reads, FieldRead::Matched);
        assert_eq!(
            check(&["xxxxxxxx"]),
            verdict(Outcome::Refused, "mask-read-for-revealed")
        );
        assert_eq!(
            check(&["", "xxx"]),
            verdict(Outcome::Refused, "mask-read-for-revealed")
        );
        assert_eq!(
            check(&["", "  "]),
            verdict(Outcome::Refused, "blank-read-as-masked")
        );
        assert_eq!(
            check(&[]),
            verdict(Outcome::Refused, "blank-read-as-masked")
        );
    }

    #[test]
    fn another_name_is_refused_by_how_close_the_closest_reading_is() {
        let check = |reads: &[&str]| party(reads, FieldRead::Matched).reason;
        assert_eq!(check(&["DUELNK LOCKS"]), "field-other-spacing");
        assert_eq!(check(&["DUEL NK  LOCKS"]), "field-other-spacing");
        assert_eq!(check(&["DUEL NK LOCK"]), "field-other-1-edit:ins(s)@12");
        assert_eq!(
            check(&["DUEL NK LOC"]),
            "field-other-2-edits:ins(k)@11,ins(s)@12"
        );
        assert_eq!(check(&["something else"]), "field-other-far");
        // The closest of all the readings counts; a blank reading does not.
        assert_eq!(
            check(&["something else", "", "DUEL NK LOCK"]),
            "field-other-1-edit:ins(s)@12"
        );
        // Expecting masked, another name is refused the same way.
        assert_eq!(
            party(&["DUEL NK LOCK"], FieldRead::Masked),
            verdict(Outcome::Refused, "field-other-1-edit:ins(s)@12")
        );
    }

    #[test]
    fn a_field_with_nothing_but_blank_readings_that_is_not_masked_is_other_blank() {
        // Unreachable through `read_field_variants`, so the reason function is checked directly.
        assert_eq!(
            other_reason(&["", " "], PARTY_ROOM_NAME),
            "field-other-blank"
        );
        assert_eq!(other_reason(&[], PARTY_ROOM_NAME), "field-other-blank");
    }

    #[test]
    fn edit_distance_counts_insertions_deletions_and_substitutions() {
        assert_eq!(edit_distance("", ""), 0);
        assert_eq!(edit_distance("abc", ""), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("abc", "abc"), 0);
        assert_eq!(edit_distance("abc", "abd"), 1);
        assert_eq!(edit_distance("abc", "abcd"), 1);
        assert_eq!(edit_distance("abcd", "abc"), 1);
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("ab", "ba"), 2);
    }

    #[test]
    fn the_backtrace_names_each_edit_by_its_position_in_the_expected_string() {
        let ops = |read: &str, expected: &str| edit_operations(read, expected);
        assert!(ops("abc", "abc").is_empty());
        assert_eq!(ops("duel nk l0cks", "duel nk locks"), ["sub(0>o)@9"]);
        assert_eq!(ops("duelnk locks", "duel nk locks"), ["ins( )@4"]);
        assert_eq!(ops("duel  nk locks", "duel nk locks"), ["del( )@4"]);
        assert_eq!(ops("duel nk lock", "duel nk locks"), ["ins(s)@12"]);
        assert_eq!(ops("xduel nk locks", "duel nk locks"), ["del(x)@0"]);
        assert_eq!(ops("", "ab"), ["ins(a)@0", "ins(b)@1"]);
        assert_eq!(ops("ab", ""), ["del(a)@0", "del(b)@0"]);
        // Two edits come in order of position.
        assert_eq!(ops("axcyd", "abcd"), ["sub(x>b)@1", "del(y)@3"]);
        // A character outside [a-z0-9 ] prints as ?.
        assert_eq!(ops("a-c", "abc"), ["sub(?>b)@1"]);
        assert_eq!(ops("aéc", "abc"), ["sub(?>b)@1"]);
        assert_eq!(printable('Z'), '?');
    }

    #[test]
    fn the_operations_are_only_printed_against_the_party_room_name() {
        let reasons = |expected: &str| other_reason(&["secret nam"], expected);
        assert_eq!(reasons("secret name"), "field-other-1-edit");
        assert_eq!(
            other_reason(&["DUEL NK LACKS"], PARTY_ROOM_NAME),
            "field-other-1-edit:sub(a>o)@9"
        );
    }

    #[test]
    fn a_generated_game_name_is_classified_against_its_own_name_with_its_edits() {
        assert_eq!(
            classify_party(true, &["mmbaalh-19"], "mmbaalh-19", FieldRead::Matched),
            verdict(Outcome::Correct, "field-as-expected")
        );
        assert_eq!(
            other_reason(&["mmbaa1h-19"], "mmbaalh-19"),
            "field-other-1-edit:sub(1>l)@5"
        );
        // A read of another file's name is far, not a match.
        assert_eq!(
            classify_party(true, &["mmtzh-47"], "mmbaalh-19", FieldRead::Matched).outcome,
            Outcome::Refused
        );
        assert_eq!(
            field_variant_classes(&["mmbaalh-19", "mmbaalh-1"], "mmbaalh-19"),
            ["match", "1-edit"]
        );
    }

    #[test]
    fn each_variant_reading_of_the_field_gets_a_class_in_reader_order() {
        assert_eq!(
            field_variant_classes(
                &[
                    "DUEL NK LOCKS",
                    "xxx",
                    "  ",
                    "DUEL NK LOCK",
                    "DUEL NK LOC",
                    "something else"
                ],
                PARTY_ROOM_NAME
            ),
            ["match", "masked", "blank", "1-edit", "2-edits", "far"]
        );
        assert!(field_variant_classes(&[], PARTY_ROOM_NAME).is_empty());
    }

    #[test]
    fn a_party_frame_expecting_masked() {
        let check = |reads: &[&str]| party(reads, FieldRead::Masked);
        assert_eq!(
            check(&["xxxx"]),
            verdict(Outcome::Correct, "field-as-expected")
        );
        assert_eq!(check(&[""]).outcome, Outcome::Correct);
        assert_eq!(
            check(&["DUEL NK LOCKS"]),
            verdict(Outcome::Wrong, "matched-read-for-masked")
        );
    }

    #[test]
    fn the_selection_screen_branches() {
        let cards = [
            crate::ocr_check::MAINTAINER_CARDS[0],
            crate::ocr_check::MAINTAINER_CARDS[1],
        ];
        let select = |cards_read| reading(Screen::CharacterSelect, cards_read);
        assert_eq!(
            classify_select(&select(expected_cards()), &cards).outcome,
            Outcome::Correct
        );
        // The name is compared without case.
        let mut upper = expected_cards();
        upper[0] = card("VUKVUKA", Class::Sorceress, 88, Some(Title::Matriarch));
        assert_eq!(
            classify_select(&select(upper), &cards).outcome,
            Outcome::Correct
        );
        // Not the selection screen.
        assert_eq!(
            classify_select(&reading(Screen::Unknown, expected_cards()), &cards),
            verdict(Outcome::Refused, "not-the-select-screen")
        );
        // Cards refused: none, or only the first.
        assert_eq!(
            classify_select(&select(vec![]), &cards).outcome,
            Outcome::Refused
        );
        assert_eq!(
            classify_select(&select(expected_cards()[..1].to_vec()), &cards).reason,
            "cards-refused-1of2-slots0"
        );
        // Each field that differs is Wrong.
        let differ = |index: usize, other: Character| {
            let mut read = expected_cards();
            read[index] = other;
            classify_select(&select(read), &cards)
        };
        let wrong = |verdict: Verdict, reason: &str| {
            assert_eq!(verdict.outcome, Outcome::Wrong, "{verdict:?}");
            assert_eq!(verdict.reason, reason);
        };
        wrong(
            differ(
                0,
                card("vukVukb", Class::Sorceress, 88, Some(Title::Matriarch)),
            ),
            "card0-name=other:sub(b>a)@6",
        );
        wrong(
            differ(
                0,
                card("vukVuka", Class::Amazon, 88, Some(Title::Matriarch)),
            ),
            "card0-class=Amazon",
        );
        wrong(
            differ(
                0,
                card("vukVuka", Class::Sorceress, 87, Some(Title::Matriarch)),
            ),
            "card0-level=87",
        );
        wrong(
            differ(0, card("vukVuka", Class::Sorceress, 88, None)),
            "card0-title=None",
        );
        wrong(
            differ(
                1,
                card("vukaDao", Class::Sorceress, 11, Some(Title::Matriarch)),
            ),
            "card1-title=Matriarch",
        );
        wrong(
            differ(1, card("other", Class::Amazon, 11, Some(Title::Matriarch))),
            "card1-name=other:ins(v)@0,ins(u)@1,sub(o>k)@2,sub(t>v)@3,sub(h>u)@4,sub(e>k)@5,sub(r>a)@6+class=Amazon+title=Matriarch",
        );
        wrong(
            differ(
                0,
                card("other", Class::Sorceress, 1, Some(Title::Matriarch)),
            ),
            "card0-name=other:ins(v)@0,ins(u)@1,sub(o>k)@2,sub(t>v)@3,sub(h>u)@4,sub(e>k)@5,sub(r>a)@6+level=1",
        );
        // A card is matched to the expected one with its name, without case, wherever it sits (deliberate: it was
        // `card0-name=card1+level=11`): the other fields are then compared with that card's, and the text is never printed.
        wrong(
            differ(
                0,
                card("VUKADAO", Class::Sorceress, 11, Some(Title::Matriarch)),
            ),
            "card1-title=Matriarch",
        );
        wrong(
            differ(
                1,
                card("vukvuka", Class::Sorceress, 11, Some(Title::Slayer)),
            ),
            "card0-level=11+title=Slayer",
        );
        // The first card missing and the second read first is a missing card (Refused), not a wrong one.
        let missing_first = classify_select(
            &select(vec![card("vukaDao", Class::Sorceress, 11, None)]),
            &cards,
        );
        assert_eq!(missing_first.outcome, Outcome::Refused);
        assert_eq!(missing_first.reason, "cards-refused-1of2-slots0");
        // A wrong card is Wrong even when the other card was refused.
        assert_eq!(
            classify_select(
                &select(vec![card(
                    "other",
                    Class::Sorceress,
                    88,
                    Some(Title::Matriarch)
                )]),
                &cards
            )
            .outcome,
            Outcome::Wrong
        );
        // A card the screen does not show.
        let mut extra = expected_cards();
        extra.push(card("third", Class::Druid, 3, None));
        assert_eq!(classify_select(&select(extra), &cards).reason, "extra-card");
    }

    #[test]
    fn refused_cards_say_how_many_were_read_and_why_the_others_were_not() {
        use d2rmm_agent_domain::character_screen::{RejectReason, Rejection};

        let cards = [
            crate::ocr_check::MAINTAINER_CARDS[0],
            crate::ocr_check::MAINTAINER_CARDS[1],
        ];
        let mut read = reading(Screen::CharacterSelect, expected_cards()[..1].to_vec());
        read.slots_read = 2;
        read.rejected = vec![Rejection {
            slot: 1,
            reason: RejectReason::TitleUnread,
        }];
        assert_eq!(
            classify_select(&read, &cards).reason,
            "cards-refused-1of2-slots2-title-unread"
        );
        // The kinds are sorted and listed once.
        read.cards.clear();
        read.rejected = vec![
            Rejection {
                slot: 1,
                reason: RejectReason::NameUnread,
            },
            Rejection {
                slot: 0,
                reason: RejectReason::LevelUnread,
            },
            Rejection {
                slot: 2,
                reason: RejectReason::NameUnread,
            },
        ];
        assert_eq!(
            classify_select(&read, &cards).reason,
            "cards-refused-0of2-slots2-level-unread+name-unread"
        );
        // The popup adds how many of its options were found.
        read.popup_options = 3;
        let verdict = classify_popup(&read, &cards);
        assert_eq!(verdict.outcome, Outcome::Refused);
        assert_eq!(
            verdict.reason,
            "cards-refused-0of2-slots2-level-unread+name-unread-options3"
        );
    }

    #[test]
    fn the_popup_branches() {
        let cards = [
            crate::ocr_check::MAINTAINER_CARDS[0],
            crate::ocr_check::MAINTAINER_CARDS[1],
        ];
        let popup = |first: Character| {
            let mut read = expected_cards();
            read[0] = first;
            classify_popup(&reading(Screen::CharacterSelect, read), &cards)
        };
        let matriarch = || card("vukVuka", Class::Sorceress, 88, Some(Title::Matriarch));
        // The title alone unlocks Normal, Nightmare and Hell.
        assert_eq!(popup(matriarch()).outcome, Outcome::Correct);
        let all = [Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell];
        assert_eq!(
            popup(matriarch().with_popup_difficulties(&all).unwrap()),
            verdict(Outcome::Correct, "difficulties-as-expected")
        );
        // Another non-empty set is Wrong.
        let dimmed = matriarch()
            .with_popup_difficulties(&[Difficulty::Normal])
            .unwrap();
        assert_eq!(
            popup(dimmed),
            verdict(Outcome::Wrong, "difficulties-normal")
        );
        let two = matriarch()
            .with_popup_difficulties(&[Difficulty::Normal, Difficulty::Nightmare])
            .unwrap();
        assert_eq!(
            popup(two),
            verdict(Outcome::Wrong, "difficulties-normal+nightmare")
        );
        // The cards' own rules come first.
        assert_eq!(
            classify_popup(&reading(Screen::Unknown, expected_cards()), &cards).outcome,
            Outcome::Refused
        );
        assert_eq!(
            classify_popup(&reading(Screen::CharacterSelect, vec![]), &cards).outcome,
            Outcome::Refused
        );
    }

    #[test]
    fn the_outcome_names_and_the_unsupported_size() {
        assert_eq!(Outcome::Correct.name(), "correct");
        assert_eq!(Outcome::Refused.name(), "refused");
        assert_eq!(Outcome::Wrong.name(), "wrong");
        assert_eq!(UNSUPPORTED_SIZE.outcome, Outcome::Refused);
    }

    /// Reads nothing: every region is blank.
    struct Blank;

    impl TextReader for Blank {
        fn read(
            &self,
            _image: &Rgba,
            _region: d2rmm_agent_domain::vision::Region,
        ) -> Result<d2rmm_agent_domain::vision::ReadText, d2rmm_agent_core::ports::ReadError>
        {
            Ok(d2rmm_agent_domain::vision::ReadText {
                text: String::new(),
                confidence: 0.0,
            })
        }
    }

    #[test]
    fn classify_image_refuses_an_unsupported_size_and_a_blank_frame() {
        use std::sync::Arc;

        let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(Blank);
        let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
        let tiny = Rgba {
            width: 100,
            height: 100,
            pixels: Vec::new(),
        };
        assert_eq!(
            classify_image("maintainer-party-masked.png", &*reader, &screens, &tiny),
            UNSUPPORTED_SIZE
        );
        let frame = Rgba {
            width: 1920,
            height: 1033,
            pixels: Vec::new(),
        };
        for name in [
            "maintainer-party-revealed.png",
            "maintainer-party-masked.png",
            "maintainer-select-screen.png",
            "maintainer-select-difficulty.png",
            "maintainer-automap-en-mmbaalh-19.png",
            "maintainer-chat-pt-joined-open-1.png",
            "something-else.png",
        ] {
            let got = classify_image(name, &*reader, &screens, &frame);
            assert_eq!(got.outcome, Outcome::Refused, "{name}: {got:?}");
        }
        assert_eq!(
            classify_image(
                "maintainer-automap-en-mmbaalh-19.png",
                &*reader,
                &screens,
                &frame
            ),
            verdict(Outcome::Refused, "automap-no-lines")
        );
        assert_eq!(
            classify_image(
                "maintainer-chat-pt-joined-open-1.png",
                &*reader,
                &screens,
                &frame
            ),
            verdict(Outcome::Refused, "chat-no-lines")
        );
    }

    fn lines(texts: &[&str]) -> Vec<TextLine> {
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| TextLine {
                text: (*text).to_string(),
                region: d2rmm_agent_domain::vision::Region {
                    x: 0,
                    y: 20 * index as u32,
                    width: 200,
                    height: 18,
                },
            })
            .collect()
    }

    #[test]
    fn an_automap_name_line_is_correct_when_a_variant_reads_the_name_and_refused_with_its_class_otherwise()
     {
        let name = "mmbaalh-19";
        assert_eq!(
            classify_automap(&[lines(&["Vuk#1234"]), lines(&["MM8AALH-19"])], name),
            verdict(Outcome::Correct, "name-line-as-expected")
        );
        assert_eq!(
            classify_automap(&[vec![], vec![]], name),
            verdict(Outcome::Refused, "automap-no-lines")
        );
        assert_eq!(
            classify_automap(&[lines(&["mmbaalh-18"])], name),
            verdict(Outcome::Refused, "automap-other-1-edit:sub(8>9)@9")
        );
        assert_eq!(
            classify_automap(&[lines(&["mmbaalh-1"])], name).reason,
            "automap-other-1-edit:ins(9)@9"
        );
        // GNR-05 (T9): a generated name the engine spaced is read as itself, so it is no longer refused for its spacing; the
        // spacing class stays for the public room name, which keeps its own spaces (`another_name_is_refused_by_how_close...`).
        assert_eq!(
            classify_automap(&[lines(&["mmb a alh-19"])], name),
            verdict(Outcome::Correct, "name-line-as-expected")
        );
        assert_eq!(
            classify_automap(&[lines(&["mmb a alh-18"])], name).outcome,
            Outcome::Refused
        );
        assert_eq!(
            classify_automap(&[lines(&["Hell"])], name),
            verdict(Outcome::Refused, "automap-other-far")
        );
        assert_eq!(
            classify_automap(&[lines(&["  "])], name),
            verdict(Outcome::Refused, "automap-other-blank")
        );
    }

    #[test]
    fn an_automap_name_after_its_label_is_correct_by_the_agents_own_rule_and_another_name_is_not() {
        let name = "mmchaosh-20";
        assert_eq!(
            classify_automap(&[lines(&["Nome do Jogo: mmchaosh-20"])], name),
            verdict(Outcome::Correct, "name-line-as-expected")
        );
        assert_eq!(
            classify_automap(&[lines(&["Game; mm chaosh - 20"])], name),
            verdict(Outcome::Correct, "name-line-as-expected")
        );
        assert_eq!(
            classify_automap(&[lines(&["Game: mmchaosh-21"])], name).outcome,
            Outcome::Refused
        );
        assert_eq!(
            classify_automap(&[lines(&["Game: mmchaosm-20"])], name).outcome,
            Outcome::Refused
        );
    }

    #[test]
    fn a_chat_print_is_correct_on_its_event_wrong_on_the_other_and_refused_without_a_phrase_or_a_name()
     {
        use crate::ocr_check::{ChatClass, ChatExpectation, PrintLanguage, chat_reading};
        let pt = |class| ChatExpectation {
            language: PrintLanguage::Portuguese,
            class,
        };
        let joined = chat_reading(&[lines(&["Bob entrou em nosso mundo"])]);
        assert_eq!(
            classify_chat(&joined, pt(Some(ChatClass::Joined))),
            verdict(Outcome::Correct, "chat-event-as-expected")
        );
        assert_eq!(
            classify_chat(&joined, pt(None)),
            verdict(Outcome::Correct, "chat-event-found")
        );
        assert_eq!(
            classify_chat(&joined, pt(Some(ChatClass::Left))),
            verdict(Outcome::Wrong, "chat-event-joined-for-left")
        );
        let left = chat_reading(&[lines(&["Bob saiu de nosso mundo"])]);
        assert_eq!(
            classify_chat(&left, pt(Some(ChatClass::Joined))),
            verdict(Outcome::Wrong, "chat-event-left-for-joined")
        );
        assert_eq!(
            classify_chat(&chat_reading(&[lines(&["Bob says hello"])]), pt(None)),
            verdict(Outcome::Refused, "chat-no-phrase")
        );
        assert_eq!(
            classify_chat(&chat_reading(&[vec![]]), pt(None)),
            verdict(Outcome::Refused, "chat-no-lines")
        );
        let both = chat_reading(&[lines(&[
            "Bob entrou em nosso mundo",
            "Bob saiu do nosso mundo",
        ])]);
        assert_eq!(
            classify_chat(&both, pt(None)),
            verdict(Outcome::Correct, "chat-event-found-both")
        );
        assert_eq!(
            classify_chat(&both, pt(Some(ChatClass::Joined))),
            verdict(Outcome::Refused, "chat-both-classes")
        );
        assert_eq!(
            classify_chat(
                &chat_reading(&[lines(&["entrou em nosso mundo", "saiu do nosso mundo"])]),
                pt(None)
            ),
            verdict(Outcome::Refused, "chat-no-name"),
            "both classes still need a name before a phrase"
        );
        assert_eq!(
            classify_chat(
                &chat_reading(&[lines(&["entrou em nosso mundo"])]),
                pt(Some(ChatClass::Joined))
            ),
            verdict(Outcome::Refused, "chat-no-name")
        );
        assert_eq!(
            classify_chat(
                &joined,
                ChatExpectation {
                    language: PrintLanguage::English,
                    class: None
                }
            ),
            verdict(Outcome::Refused, "chat-no-phrase"),
            "the candidates of the other language do not count"
        );
    }

    /// Pin (rule 14, before `classify_chat` accepts both classes): a print whose file names a class, and a print holding
    /// both classes, stay Refused with the reason the classifier gives today.
    #[test]
    fn a_chat_print_holding_both_classes_is_refused_when_the_file_names_a_class() {
        use crate::ocr_check::{ChatClass, ChatExpectation, PrintLanguage, chat_reading};
        let both = chat_reading(&[lines(&["Bob joined our world", "Eve left our world"])]);
        for class in [ChatClass::Joined, ChatClass::Left] {
            assert_eq!(
                classify_chat(
                    &both,
                    ChatExpectation {
                        language: PrintLanguage::English,
                        class: Some(class)
                    }
                ),
                verdict(Outcome::Refused, "chat-both-classes")
            );
        }
    }

    #[test]
    fn a_read_outside_ascii_prints_as_its_code_point_and_other_ascii_as_a_private_use_code() {
        assert_eq!(
            other_reason(&["mmbaa\u{e5}h-19"], "mmbaalh-19"),
            "field-other-1-edit:sub(U+00E5>l)@5"
        );
        assert_eq!(
            other_reason(&["mmbaa?h-19"], "mmbaalh-19"),
            "field-other-1-edit:sub(U+F03F>l)@5"
        );
        assert_eq!(
            other_reason(&["mmbaa~h-19"], "mmbaalh-19"),
            "field-other-1-edit:sub(U+F07E>l)@5"
        );
        assert_eq!(field_glyph('-'), '-');
        assert_eq!(field_glyph('Z'), '\u{f05a}');
    }

    #[test]
    fn a_chat_print_with_no_phrase_names_the_nearest_phrase_edits_of_its_language_only() {
        use crate::ocr_check::{ChatExpectation, PrintLanguage, chat_reading};
        let en = |class| ChatExpectation {
            language: PrintLanguage::English,
            class,
        };
        let near = chat_reading(&[lines(&["Bob joined our w0rld"])]);
        assert_eq!(
            classify_chat(&near, en(None)),
            verdict_owned(Outcome::Refused, "chat-no-phrase:sub(0>o)@10".to_string())
        );
        let far = chat_reading(&[lines(&["Bob says hello"])]);
        assert_eq!(
            classify_chat(&far, en(None)),
            verdict(Outcome::Refused, "chat-no-phrase")
        );
        let accented = chat_reading(&[lines(&["Bob left our w\u{f6}rld"])]);
        assert_eq!(
            classify_chat(&accented, en(None)),
            verdict_owned(Outcome::Refused, "chat-no-phrase:sub(~>o)@8".to_string())
        );
    }

    /// A made-up name next to a misread phrase never reaches the reason: the printed stretch is the phrase's own span, and a
    /// stretch that would begin inside the name prints no operations at all.
    #[test]
    fn no_character_of_a_name_next_to_a_misread_phrase_reaches_the_reason() {
        use crate::ocr_check::{ChatExpectation, PrintLanguage, chat_reading};
        let reason = |language, text: &str| {
            classify_chat(
                &chat_reading(&[lines(&[text])]),
                ChatExpectation {
                    language,
                    class: None,
                },
            )
            .reason
            .into_owned()
        };
        let en = PrintLanguage::English;
        let pt = PrintLanguage::Portuguese;
        // The phrase's own span is printed, the name is not.
        assert_eq!(
            reason(en, "Qxz Vwk jo1ned our world"),
            "chat-no-phrase:sub(1>i)@2"
        );
        assert_eq!(
            reason(pt, "Qxz Vwk entr0u em nosso mundo"),
            "chat-no-phrase:sub(0>o)@4"
        );
        // A name that ends in the phrase's first two letters, with the rest of the phrase lost: the stretch would begin
        // inside the name and print its letters, so there are no operations.
        assert_eq!(reason(en, "Qxjoab ed our world"), "chat-no-phrase");
        // The same stretch after a space is the phrase's own and still prints.
        assert_eq!(
            reason(en, "Qxjoab joaned our world"),
            "chat-no-phrase:sub(a>i)@2"
        );
        // A start lost in the name (the `j` dropped) would need the window to begin inside it: no operations.
        assert_eq!(reason(en, "Joe ined our world"), "chat-no-phrase");
        assert_eq!(reason(en, "Qxz Vwk oined our world"), "chat-no-phrase");
        assert_eq!(reason(en, "Qxz Vwk"), "chat-no-phrase");
        // Misreads in the tail print the tail's characters, which follow the phrase's exact start.
        assert_eq!(
            reason(en, "Qxz Vwk left our w0rld"),
            "chat-no-phrase:sub(0>o)@8"
        );
        // No reason, whatever the line, holds a letter that only the name has.
        for text in [
            "Qxz Vwk jo1ned our world",
            "Qxz Vwk entr0u em nosso mundo",
            "Qxz Vwk left our w\u{f6}rld",
            "Qxz Vwk oined our world",
            "Qxz Vwk",
        ] {
            for language in [en, pt] {
                let said = reason(language, text);
                assert!(
                    !said.contains(['q', 'x', 'z', 'v', 'w', 'k', 'Q', 'X', 'Z', 'V', 'W', 'K']),
                    "{text} -> {said}"
                );
            }
        }
    }
}
