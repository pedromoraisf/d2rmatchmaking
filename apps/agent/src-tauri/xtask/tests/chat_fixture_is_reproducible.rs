//! The committed chat fixtures are what `draw-fixture chat` renders, byte for byte, with the sidecars it writes
//! (game-name-reading GNR-07), each line sits in the chat band, and the words classify as the scenarios need.

use std::fs;

use d2rmm_agent_domain::chat::{ChatEvent, classify};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
use xtask::chat_fixture::{
    ChatFixture, chat_fixture_dir, chat_fixtures, chat_sidecar, render_chat_png,
};

#[test]
fn chat_fixtures_are_reproducible() {
    for fixture in chat_fixtures() {
        let name = format!("{}.png", fixture.file);
        let committed = fs::read(chat_fixture_dir().join(&name)).unwrap_or_else(|_| {
            panic!("{name} is committed; `cargo run -p xtask -- draw-fixture chat` writes it")
        });
        let rendered = render_chat_png(&fixture).expect("the chat fixture renders");
        assert!(
            committed == rendered,
            "{name} is not what draw-fixture chat renders"
        );
        let sidecar = format!("{name}.json");
        let held = fs::read_to_string(chat_fixture_dir().join(&sidecar))
            .unwrap_or_else(|_| panic!("{sidecar} is committed"));
        assert_eq!(held, chat_sidecar(&fixture), "{sidecar} holds the lines");
    }
}

#[test]
fn every_line_sits_in_the_chat_band_of_its_client() {
    for fixture in chat_fixtures() {
        let band =
            screen_region(ScreenRegion::ChatArea, 1920, fixture.height).expect("the band resolves");
        for (text, region) in &fixture.lines {
            assert!(
                band.x <= region.x
                    && region.right() <= band.right()
                    && band.y <= region.y
                    && region.bottom() <= band.bottom(),
                "{}: {text}",
                fixture.file
            );
        }
    }
}

fn events_of(fixture: &ChatFixture, pack: &LanguagePack) -> Vec<ChatEvent> {
    fixture
        .lines
        .iter()
        .filter_map(|(text, _)| classify(pack, text).map(|(event, _)| event))
        .collect()
}

fn fixture(file: &str) -> ChatFixture {
    chat_fixtures()
        .into_iter()
        .find(|held| held.file == file)
        .unwrap_or_else(|| panic!("{file} is drawn"))
}

#[test]
fn the_english_frames_say_joined_left_both_or_nothing() {
    let pack = LanguagePack::english();
    assert_eq!(
        events_of(&fixture("chat-joined"), &pack),
        [ChatEvent::Joined]
    );
    assert_eq!(events_of(&fixture("chat-left"), &pack), [ChatEvent::Left]);
    assert_eq!(
        events_of(&fixture("chat-both"), &pack),
        [ChatEvent::Joined, ChatEvent::Left]
    );
    assert_eq!(events_of(&fixture("chat-no-words"), &pack), []);
}

#[test]
fn the_portuguese_pair_says_joined_and_left_with_the_portuguese_words() {
    let words = [
        ("party", "Grupo"),
        ("gameName", "Nome"),
        ("password", "Senha"),
        ("joinedGame", "entrou em nosso mundo"),
        ("leftGame", "saiu de nosso mundo"),
    ]
    .map(|(key, word)| (key.to_string(), word.to_string()));
    let pack = LanguagePack::from_words("pt-BR", words).expect("the pack builds");
    assert_eq!(
        events_of(&fixture("chat-pt-joined"), &pack),
        [ChatEvent::Joined]
    );
    assert_eq!(
        events_of(&fixture("chat-pt-left"), &pack),
        [ChatEvent::Left, ChatEvent::Joined]
    );
    assert_eq!(
        events_of(&fixture("chat-pt-joined"), &LanguagePack::english()),
        []
    );
}

#[test]
fn the_same_line_scrolls_to_another_box_with_the_same_text() {
    let first = fixture("chat-joined");
    let later = fixture("chat-joined-later");
    assert_eq!(first.lines[0].0, later.lines[0].0);
    assert_ne!(first.lines[0].1, later.lines[0].1);
}

#[test]
fn the_names_are_made_up() {
    for fixture in chat_fixtures() {
        for (text, _) in &fixture.lines {
            assert!(text.starts_with("Bob") || text.starts_with("Eve"), "{text}");
        }
    }
}
