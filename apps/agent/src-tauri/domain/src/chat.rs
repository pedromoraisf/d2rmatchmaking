//! The chat's joined and left lines (game-name-reading GNR-07). D2R writes "<name> joined our world" and "<name> left our
//! world" (English) and "<name> entrou em nosso mundo" and "<name> saiu de nosso mundo" (Portuguese) in the chat area. The
//! phrases are data of the language pack (`joinedGame`, `leftGame`), found on the maintainer's chat prints by `ocr-real`;
//! the player's name is the text before the phrase. A line the classifier cannot parse is nothing, and so is a blank name.
//! The events stay in the process: they are counted by their kind and never posted, logged or put in a span (GNR-10).
//! Pure: no I/O, no clock, no randomness.

use std::collections::BTreeMap;

use crate::language::{JOINED_GAME, LEFT_GAME, LanguagePack};

/// What a chat line says happened to a player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatEvent {
    Joined,
    Left,
}

impl ChatEvent {
    /// The fixed word the counter carries (`kind`): never a name.
    pub fn kind(self) -> &'static str {
        match self {
            Self::Joined => "joined",
            Self::Left => "left",
        }
    }
}

/// A line in its comparison form: lower case, every run of whitespace one space, trimmed.
fn folded(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// What a chat line says, by the pack's two phrases, and the name before the phrase. The phrase that starts earlier in the
/// line wins; a line with neither, or with no name before the phrase, is `None`. The name is as the line reads, trimmed.
pub fn classify(pack: &LanguagePack, line: &str) -> Option<(ChatEvent, String)> {
    let text = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = text.to_lowercase();
    let found = [
        (ChatEvent::Joined, JOINED_GAME),
        (ChatEvent::Left, LEFT_GAME),
    ]
    .into_iter()
    .filter_map(|(event, key)| {
        let phrase = folded(pack.word(key)?);
        if phrase.is_empty() {
            return None;
        }
        Some((lower.find(&phrase)?, event))
    })
    .min_by_key(|(at, _)| *at)?;
    let (at, event) = found;
    // `to_lowercase` may change a character's byte length, so the name is cut from the text only where both agree.
    let name = if lower.len() == text.len() {
        text.get(..at)?.trim().to_string()
    } else {
        lower.get(..at)?.trim().to_string()
    };
    (!name.is_empty()).then_some((event, name))
}

/// `classify` with each pack in turn (a Portuguese client's chat is read with its pack after the English one): the first pack
/// that parses the line gives the event and the name.
pub fn classify_any(packs: &[&LanguagePack], line: &str) -> Option<(ChatEvent, String)> {
    packs.iter().find_map(|pack| classify(pack, line))
}

/// The lines of the chat area across frames. D2R fades a chat line after a few seconds and a new line scrolls the others, so
/// a line is new when the frame holds more copies of its text than the previous frame did: a line that stays on screen is
/// counted once, and a name that joins, leaves and joins again is three events.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChatTracker {
    previous: BTreeMap<String, usize>,
}

impl ChatTracker {
    /// The events of the lines of one frame that were not in the previous frame, in the order the lines come. Lines no pack
    /// classifies are not events. The frame replaces the previous one.
    pub fn next(&mut self, packs: &[&LanguagePack], lines: &[&str]) -> Vec<ChatEvent> {
        let mut now: BTreeMap<String, usize> = BTreeMap::new();
        let mut events = Vec::new();
        for line in lines {
            let key = folded(line);
            if key.is_empty() {
                continue;
            }
            let seen = now.entry(key.clone()).or_insert(0);
            *seen += 1;
            let before = self.previous.get(&key).copied().unwrap_or(0);
            if *seen > before
                && let Some((event, _)) = classify_any(packs, line)
            {
                events.push(event);
            }
        }
        self.previous = now;
        events
    }

    /// Forgets the previous frame (the game was left, or the chat area was not read).
    pub fn reset(&mut self) {
        self.previous.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{ChatEvent, ChatTracker, classify};
    use crate::language::LanguagePack;

    fn english() -> LanguagePack {
        LanguagePack::english()
    }

    fn portuguese() -> LanguagePack {
        let words = [
            ("party", "Grupo"),
            ("gameName", "Nome"),
            ("password", "Senha"),
            ("joinedGame", "entrou em nosso mundo"),
            ("leftGame", "saiu de nosso mundo"),
        ]
        .map(|(key, word)| (key.to_string(), word.to_string()));
        LanguagePack::from_words("pt-BR", words).expect("the pack builds")
    }

    /// The four phrases CI found on the maintainer's chat prints (`ocr-real`, job 136538900128), with made-up names.
    #[test]
    fn the_four_measured_phrases_classify_with_the_name_before_them() {
        let cases = [
            (english(), "Bob joined our world", ChatEvent::Joined, "Bob"),
            (english(), "Bob left our world", ChatEvent::Left, "Bob"),
            (
                portuguese(),
                "Bob entrou em nosso mundo",
                ChatEvent::Joined,
                "Bob",
            ),
            (
                portuguese(),
                "Bob saiu de nosso mundo",
                ChatEvent::Left,
                "Bob",
            ),
        ];
        for (pack, line, event, name) in cases {
            assert_eq!(
                classify(&pack, line),
                Some((event, name.to_string())),
                "{line}"
            );
        }
    }

    #[test]
    fn a_phrase_of_the_other_language_is_not_this_packs() {
        assert_eq!(classify(&english(), "Bob entrou em nosso mundo"), None);
        assert_eq!(classify(&english(), "Bob saiu de nosso mundo"), None);
        assert_eq!(classify(&portuguese(), "Bob joined our world"), None);
        assert_eq!(classify(&portuguese(), "Bob left our world"), None);
    }

    #[test]
    fn the_candidates_that_ci_did_not_find_are_not_phrases() {
        assert_eq!(classify(&portuguese(), "Bob entrou no nosso mundo"), None);
        assert_eq!(classify(&portuguese(), "Bob saiu do nosso mundo"), None);
    }

    #[test]
    fn case_and_spacing_do_not_change_the_event() {
        assert_eq!(
            classify(&english(), "  Bob   JOINED  our   world. "),
            Some((ChatEvent::Joined, "Bob".to_string()))
        );
        assert_eq!(
            classify(&english(), "Bob Smith left our world"),
            Some((ChatEvent::Left, "Bob Smith".to_string()))
        );
    }

    #[test]
    fn a_line_with_no_phrase_or_no_name_is_nothing() {
        let pack = english();
        for line in [
            "",
            "   ",
            "Bob: hello there",
            "joined our world",
            "  left our world",
            "Difficulty: Hell",
            "Bob joined our",
        ] {
            assert_eq!(classify(&pack, line), None, "{line:?}");
        }
    }

    #[test]
    fn the_phrase_that_starts_first_names_the_event() {
        assert_eq!(
            classify(&english(), "Bob joined our world left our world").map(|r| r.0),
            Some(ChatEvent::Joined)
        );
        assert_eq!(
            classify(&english(), "Bob left our world joined our world").map(|r| r.0),
            Some(ChatEvent::Left)
        );
    }

    #[test]
    fn a_pack_without_the_words_classifies_nothing() {
        let bare = LanguagePack::from_words(
            "xx",
            [("party", "P"), ("gameName", "G"), ("password", "W")]
                .map(|(key, word)| (key.to_string(), word.to_string())),
        )
        .expect("a pack with the required words");
        assert_eq!(classify(&bare, "Bob joined our world"), None);
    }

    #[test]
    fn the_kind_is_a_fixed_word() {
        assert_eq!(ChatEvent::Joined.kind(), "joined");
        assert_eq!(ChatEvent::Left.kind(), "left");
    }

    #[test]
    fn a_line_that_stays_on_screen_counts_once() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        assert_eq!(
            tracker.next(&[&pack], &["Bob joined our world"]),
            vec![ChatEvent::Joined]
        );
        assert_eq!(tracker.next(&[&pack], &["Bob joined our world"]), vec![]);
        assert_eq!(
            tracker.next(&[&pack], &["  bob  JOINED our world "]),
            vec![]
        );
    }

    #[test]
    fn a_name_that_joins_leaves_and_joins_again_is_three_events() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        let mut events = tracker.next(&[&pack], &["Bob joined our world"]);
        events.extend(tracker.next(&[&pack], &["Bob joined our world", "Bob left our world"]));
        // The first line faded between the frames, then the player came back.
        events.extend(tracker.next(&[&pack], &["Bob left our world"]));
        events.extend(tracker.next(&[&pack], &["Bob left our world", "Bob joined our world"]));
        assert_eq!(
            events,
            vec![ChatEvent::Joined, ChatEvent::Left, ChatEvent::Joined]
        );
    }

    #[test]
    fn two_identical_lines_in_one_frame_are_two_events_and_one_more_copy_is_one_more() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        let line = "Bob joined our world";
        assert_eq!(tracker.next(&[&pack], &[line, line]).len(), 2);
        assert_eq!(tracker.next(&[&pack], &[line, line]).len(), 0);
        assert_eq!(tracker.next(&[&pack], &[line, line, line]).len(), 1);
    }

    #[test]
    fn a_line_that_fades_and_comes_back_counts_again() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        assert_eq!(tracker.next(&[&pack], &["Bob joined our world"]).len(), 1);
        assert_eq!(tracker.next(&[&pack], &[]).len(), 0);
        assert_eq!(tracker.next(&[&pack], &["Bob joined our world"]).len(), 1);
    }

    #[test]
    fn lines_that_are_not_joined_or_left_are_never_events_or_new_lines_of_one() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        assert_eq!(
            tracker.next(
                &[&pack],
                &["Bob: hello", "", "joined our world", "Difficulty: Hell"]
            ),
            vec![]
        );
    }

    #[test]
    fn a_portuguese_line_is_an_event_when_its_pack_is_listed() {
        let (en, pt) = (english(), portuguese());
        let mut tracker = ChatTracker::default();
        let lines = ["Bob entrou em nosso mundo", "Eve left our world"];
        assert_eq!(tracker.next(&[&en], &lines), vec![ChatEvent::Left]);
        let mut tracker = ChatTracker::default();
        assert_eq!(
            tracker.next(&[&en, &pt], &lines),
            vec![ChatEvent::Joined, ChatEvent::Left]
        );
        assert_eq!(super::classify_any(&[], "Bob left our world"), None);
    }

    #[test]
    fn reset_forgets_the_previous_frame() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        assert_eq!(tracker.next(&[&pack], &["Bob joined our world"]).len(), 1);
        tracker.reset();
        assert_eq!(tracker.next(&[&pack], &["Bob joined our world"]).len(), 1);
    }

    #[test]
    fn the_events_come_in_the_order_of_the_lines() {
        let pack = english();
        let mut tracker = ChatTracker::default();
        assert_eq!(
            tracker.next(&[&pack], &["Bob left our world", "Eve joined our world"]),
            vec![ChatEvent::Left, ChatEvent::Joined]
        );
    }
}
