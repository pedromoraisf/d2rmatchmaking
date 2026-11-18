//! What a reading of a variation of a screenshot amounts to: read correctly, refused (the agent said it could not read
//! it: it posts nothing) or read WRONG (a false read, the worst outcome: the agent would act on text that is not there).
//! The rules are pure functions over a reading, tested without OCR; `classify_image` runs the production reading and applies
//! them. Reasons are short classes that name no character name and no game name.
use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::party::read_panel;
use d2rmm_agent_core::ports::{FrameReader, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::characters::Difficulty;
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field_variants};
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

/// An outcome and the class of reason behind it (a fixed word, never text read from the screen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Verdict {
    pub outcome: Outcome,
    pub reason: &'static str,
}

const fn verdict(outcome: Outcome, reason: &'static str) -> Verdict {
    Verdict { outcome, reason }
}

/// The verdict of an image whose size the layout does not support.
pub const UNSUPPORTED_SIZE: Verdict = verdict(Outcome::Refused, "unsupported-size");

/// A Party frame: `open` is whether the panel was found, `got` the field's kind when it was read.
pub fn classify_party(open: bool, got: Option<FieldRead>, expected: FieldRead) -> Verdict {
    if !open {
        return verdict(Outcome::Refused, "panel-not-open");
    }
    match (got, expected) {
        (Some(got), expected) if got == expected => verdict(Outcome::Correct, "field-as-expected"),
        (Some(FieldRead::Masked), FieldRead::Matched) => {
            verdict(Outcome::Wrong, "masked-read-for-matched")
        }
        (Some(FieldRead::Matched), FieldRead::Masked) => {
            verdict(Outcome::Wrong, "matched-read-for-masked")
        }
        _ => verdict(Outcome::Refused, "field-other"),
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
            return verdict(Outcome::Wrong, "card-differs");
        }
    }
    if reading.cards.len() < cards.len() {
        return verdict(Outcome::Refused, "cards-refused");
    }
    verdict(Outcome::Correct, "cards-as-expected")
}

/// The difficulty popup: the selection screen's rules, then the first card's unlocked difficulties, which must be Normal,
/// Nightmare and Hell. Another non-empty set is Wrong; none read is Refused.
pub fn classify_popup(reading: &FrameReading, cards: &[Card]) -> Verdict {
    let cards_verdict = classify_select(reading, cards);
    if cards_verdict.outcome != Outcome::Correct {
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
        verdict(Outcome::Wrong, "difficulties-differ")
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
    let got = if panel.open {
        let field: Vec<&str> = panel.field.iter().map(|read| read.text.as_str()).collect();
        Some(read_field_variants(&field, PARTY_ROOM_NAME))
    } else {
        None
    };
    classify_party(panel.open, got, expected)
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

    #[test]
    fn a_party_frame_expecting_matched() {
        let check = |open, got| classify_party(open, got, FieldRead::Matched);
        assert_eq!(
            check(true, Some(FieldRead::Matched)).outcome,
            Outcome::Correct
        );
        assert_eq!(check(true, Some(FieldRead::Masked)).outcome, Outcome::Wrong);
        assert_eq!(
            check(true, Some(FieldRead::Other)).outcome,
            Outcome::Refused
        );
        assert_eq!(check(true, None).outcome, Outcome::Refused);
        assert_eq!(check(false, None).reason, "panel-not-open");
        assert_eq!(
            check(false, Some(FieldRead::Matched)).outcome,
            Outcome::Refused
        );
    }

    #[test]
    fn a_party_frame_expecting_masked() {
        let check = |open, got| classify_party(open, got, FieldRead::Masked);
        assert_eq!(
            check(true, Some(FieldRead::Masked)).outcome,
            Outcome::Correct
        );
        assert_eq!(
            check(true, Some(FieldRead::Matched)).outcome,
            Outcome::Wrong
        );
        assert_eq!(
            check(true, Some(FieldRead::Other)).outcome,
            Outcome::Refused
        );
        assert_eq!(check(false, None).outcome, Outcome::Refused);
        assert_eq!(
            check(true, Some(FieldRead::Matched)).reason,
            "matched-read-for-masked"
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
            "cards-refused"
        );
        // Each field that differs is Wrong.
        let differ = |index: usize, other: Character| {
            let mut read = expected_cards();
            read[index] = other;
            classify_select(&select(read), &cards)
        };
        let wrong = |verdict: Verdict| assert_eq!(verdict.outcome, Outcome::Wrong, "{verdict:?}");
        wrong(differ(
            0,
            card("vukVukb", Class::Sorceress, 88, Some(Title::Matriarch)),
        ));
        wrong(differ(
            0,
            card("vukVuka", Class::Amazon, 88, Some(Title::Matriarch)),
        ));
        wrong(differ(
            0,
            card("vukVuka", Class::Sorceress, 87, Some(Title::Matriarch)),
        ));
        wrong(differ(0, card("vukVuka", Class::Sorceress, 88, None)));
        wrong(differ(
            1,
            card("vukaDao", Class::Sorceress, 11, Some(Title::Matriarch)),
        ));
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
            verdict(Outcome::Wrong, "difficulties-differ")
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
