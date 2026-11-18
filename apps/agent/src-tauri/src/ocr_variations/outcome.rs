//! What a reading of a variation of a screenshot amounts to: read correctly, refused (the agent said it could not read
//! it: it posts nothing) or read WRONG (a false read, the worst outcome: the agent would act on text that is not there).
//! The rules are pure functions over a reading, tested without OCR; `classify_image` runs the production reading and applies
//! them. Reasons are short classes that name no character name and no game name.
use std::borrow::Cow;

use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::party::read_panel;
use d2rmm_agent_core::ports::{FrameReader, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::characters::Difficulty;
use d2rmm_agent_domain::game_name_match::{FieldRead, is_masked, normalise, read_field_variants};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::supported_size;
use d2rmm_agent_domain::presence::Screen;

use crate::ocr_check::{Card, MAINTAINER_CARDS, PARTY_ROOM_NAME};

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

/// The Levenshtein distance between two strings, in characters.
fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != *cb))
                .min(row[j] + 1)
                .min(above + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

fn without_whitespace(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Why a field that showed another name is not the expected one: how close the closest of its readings is.
fn other_reason(reads: &[&str], expected_name: &str) -> &'static str {
    let expected = normalise(expected_name);
    let closest = reads
        .iter()
        .filter(|read| !read.trim().is_empty())
        .map(|read| normalise(read))
        .map(|read| {
            if without_whitespace(&read) == without_whitespace(&expected) {
                0
            } else {
                edit_distance(&read, &expected).max(1)
            }
        })
        .min();
    match closest {
        None => "field-other-blank",
        Some(0) => "field-other-spacing",
        Some(1) => "field-other-1-edit",
        Some(2) => "field-other-2-edits",
        Some(_) => "field-other-far",
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
    if !open {
        return verdict(Outcome::Refused, "panel-not-open");
    }
    let got = read_field_variants(reads, expected_name);
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
        _ => verdict(Outcome::Refused, other_reason(reads, expected_name)),
    }
}

/// The selection screen: its cards in order against the expected ones. A card read that differs in name (without case),
/// class, level or title is Wrong, as is a card more than the screen shows; fewer cards than expected (the others refused)
/// is Refused.
pub fn classify_select(reading: &FrameReading, cards: &[Card]) -> Verdict {
    if reading.screen != Screen::CharacterSelect {
        return verdict(Outcome::Refused, "not-the-select-screen");
    }
    for (slot, card) in reading.cards.iter().enumerate() {
        let Some((name, class, level, title)) = cards.get(slot) else {
            return verdict(Outcome::Wrong, "extra-card");
        };
        if card.name().to_lowercase() != name.to_lowercase()
            || card.class() != *class
            || card.level() != *level
            || card.title() != *title
        {
            let mut fields = Vec::new();
            if card.name().to_lowercase() != name.to_lowercase() {
                fields.push("name");
            }
            if card.class() != *class {
                fields.push("class");
            }
            if card.level() != *level {
                fields.push("level");
            }
            if card.title() != *title {
                fields.push("title");
            }
            return verdict_owned(Outcome::Wrong, format!("card{slot}-{}", fields.join("+")));
        }
    }
    if reading.cards.len() < cards.len() {
        return verdict_owned(Outcome::Refused, cards_refused_reason(reading, cards.len()));
    }
    verdict(Outcome::Correct, "cards-as-expected")
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
    if !supported_size(image.width, image.height) {
        return UNSUPPORTED_SIZE;
    }
    match name {
        "maintainer-party-revealed.png" | "maintainer-party-revealed-tooltip.png" => {
            classify_party_image(reader, image, FieldRead::Matched)
        }
        "maintainer-party-masked.png" => classify_party_image(reader, image, FieldRead::Masked),
        "maintainer-select-screen.png" => classify_select(&screens.read(image), &MAINTAINER_CARDS),
        "maintainer-select-difficulty.png" => {
            classify_popup(&screens.read(image), &MAINTAINER_CARDS)
        }
        _ => verdict(Outcome::Refused, "unknown-screenshot"),
    }
}

fn classify_party_image(reader: &dyn TextReader, image: &Rgba, expected: FieldRead) -> Verdict {
    let panel = read_panel(reader, &LanguagePack::english(), image);
    let field: Vec<&str> = panel.field.iter().map(|read| read.text.as_str()).collect();
    classify_party(panel.open, &field, PARTY_ROOM_NAME, expected)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::messages::FrameReading;
    use d2rmm_agent_domain::characters::{Card as Character, Class, Mode, Title};

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
        assert_eq!(check(&["DUEL NK LOCK"]), "field-other-1-edit");
        assert_eq!(check(&["DUEL NK LOC"]), "field-other-2-edits");
        assert_eq!(check(&["something else"]), "field-other-far");
        // The closest of all the readings counts; a blank reading does not.
        assert_eq!(
            check(&["something else", "", "DUEL NK LOCK"]),
            "field-other-1-edit"
        );
        // Expecting masked, another name is refused the same way.
        assert_eq!(
            party(&["DUEL NK LOCK"], FieldRead::Masked),
            verdict(Outcome::Refused, "field-other-1-edit")
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
            "card0-name",
        );
        wrong(
            differ(
                0,
                card("vukVuka", Class::Amazon, 88, Some(Title::Matriarch)),
            ),
            "card0-class",
        );
        wrong(
            differ(
                0,
                card("vukVuka", Class::Sorceress, 87, Some(Title::Matriarch)),
            ),
            "card0-level",
        );
        wrong(
            differ(0, card("vukVuka", Class::Sorceress, 88, None)),
            "card0-title",
        );
        wrong(
            differ(
                1,
                card("vukaDao", Class::Sorceress, 11, Some(Title::Matriarch)),
            ),
            "card1-title",
        );
        wrong(
            differ(1, card("other", Class::Amazon, 11, Some(Title::Matriarch))),
            "card1-name+class+title",
        );
        wrong(
            differ(
                0,
                card("other", Class::Sorceress, 1, Some(Title::Matriarch)),
            ),
            "card0-name+level",
        );
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
            "something-else.png",
        ] {
            let got = classify_image(name, &*reader, &screens, &frame);
            assert_eq!(got.outcome, Outcome::Refused, "{name}: {got:?}");
        }
    }
}
