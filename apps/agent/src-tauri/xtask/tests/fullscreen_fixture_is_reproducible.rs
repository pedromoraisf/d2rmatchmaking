//! The committed full-screen fixtures are what `draw-fixture fullscreen` renders from their sidecars, byte for byte, and the
//! sidecars hold the lines measured on the maintainer's full-screen prints (0.1.3).

use std::fs;

use d2rmm_agent_domain::vision::Region;
use xtask::fullscreen_fixture::{
    FULLSCREEN_FIXTURES, box_of, fullscreen_fixture_dir, fullscreen_sidecar, render_fullscreen_png,
    sidecar_lines,
};

#[test]
fn fullscreen_fixtures_are_reproducible() {
    for file in FULLSCREEN_FIXTURES {
        let name = format!("{file}.png");
        let committed = fs::read(fullscreen_fixture_dir().join(&name)).unwrap_or_else(|_| {
            panic!("{name} is committed; `cargo run -p xtask -- draw-fixture fullscreen` writes it")
        });
        let rendered = render_fullscreen_png(file).expect("the full-screen fixture renders");
        assert!(
            committed == rendered,
            "{name} is not what draw-fixture fullscreen renders"
        );
    }
}

#[test]
fn the_fixtures_cover_the_selection_the_popup_and_the_party_panel() {
    assert_eq!(FULLSCREEN_FIXTURES, ["select", "difficulty", "party"]);
}

/// The middle row of the line with this text, in a sidecar.
fn middle_of(file: &str, text: &str) -> u32 {
    let sidecar = fullscreen_sidecar(file).expect("the sidecar reads");
    let lines = sidecar_lines(&sidecar).expect("the lines parse");
    let (_, region) = lines
        .iter()
        .find(|(line, _)| line == text)
        .unwrap_or_else(|| panic!("{file} has a line {text:?}"));
    region.y + region.height / 2
}

#[test]
fn the_lines_sit_where_the_full_screen_prints_measured_them() {
    // Centres in a 1920×1080 frame: the tab 53; the titled card's title 87, name 118, level 141; the second card's name 210
    // and level 233; the popup's title 385, Normal 455, Nightmare 521, Hell 586; PARTY 153, the label 192, the name 220.
    for (text, middle) in [
        ("ONLINE OFFLINE", 53),
        ("MATRIARCH", 87),
        ("vukVuka", 118),
        ("Level 88 Sorceress", 141),
        ("vukaDao", 210),
        ("Level 11 Sorceress", 233),
    ] {
        assert_eq!(middle_of("select", text), middle, "{text}");
    }
    for (text, middle) in [
        ("Select Difficulty", 385),
        ("Normal", 455),
        ("Nightmare", 521),
        ("Hell", 586),
    ] {
        assert_eq!(middle_of("difficulty", text), middle, "{text}");
    }
    for (text, middle) in [("Party", 153), ("Game Name", 192), ("mmbaalh-12", 220)] {
        assert_eq!(middle_of("party", text), middle, "{text}");
    }
}

#[test]
fn only_the_selection_fixtures_draw_a_gold_border_and_it_sits_over_the_selected_name() {
    for file in ["select", "difficulty"] {
        let sidecar = fullscreen_sidecar(file).expect("the sidecar reads");
        let gold: Region = box_of(&sidecar["gold"]).expect("a gold box");
        let name = middle_of(file, "vukVuka");
        assert!(
            name - gold.y > 38 && name - gold.y < 52,
            "{file}: the border is 38 to 52 px above the name's middle"
        );
    }
    let party = fullscreen_sidecar("party").expect("the sidecar reads");
    assert!(party.get("gold").is_none());
}
