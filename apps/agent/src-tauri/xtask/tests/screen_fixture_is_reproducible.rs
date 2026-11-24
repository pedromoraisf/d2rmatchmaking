//! The committed per-mode screen fixtures are what `draw-fixture screens` renders from their sidecars, byte for byte
//! (screen-recognition SCR-07), and each sits where the fixed reading boxes do not reach.

use std::fs;

use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
use d2rmm_agent_domain::vision::Region;
use xtask::fullscreen_fixture::{box_of, sidecar_lines};
use xtask::screen_fixture::{
    SCREEN_FIXTURES, frame_height_of, render_screen_png, screen_fixture_dir, screen_sidecar,
};

#[test]
fn screen_fixtures_are_reproducible() {
    for file in SCREEN_FIXTURES {
        let name = format!("{file}.png");
        let committed = fs::read(screen_fixture_dir().join(&name)).unwrap_or_else(|_| {
            panic!("{name} is committed; `cargo run -p xtask -- draw-fixture screens` writes it")
        });
        let rendered = render_screen_png(file).expect("the screen fixture renders");
        assert!(
            committed == rendered,
            "{name} is not what draw-fixture screens renders"
        );
    }
}

#[test]
fn the_fixtures_cover_every_mode_of_the_scenarios() {
    assert_eq!(
        SCREEN_FIXTURES,
        [
            "in-game-window",
            "in-game-fullscreen",
            "in-game-mana-only",
            "in-game-low-brightness",
            "automap-window",
            "automap-fullscreen",
            "bottom-text-only",
            "in-game-unsupported-size",
            "select-with-hud-text",
            "in-game-window-with-title-bar",
            "in-game-wrong-size-frame",
        ]
    );
}

fn middle(region: Region) -> (u32, u32) {
    (region.x + region.width / 2, region.y + region.height / 2)
}

fn inside(area: Region, (x, y): (u32, u32)) -> bool {
    area.x <= x && x < area.right() && area.y <= y && y < area.bottom()
}

#[test]
fn the_labels_sit_outside_the_fixed_boxes_of_their_client_size() {
    // The fixed Life and difficulty boxes miss these labels at their size, so only the word search reads them.
    for file in [
        "in-game-window",
        "in-game-fullscreen",
        "in-game-low-brightness",
        "automap-window",
        "automap-fullscreen",
        "select-with-hud-text",
    ] {
        let sidecar = screen_sidecar(file).expect("the sidecar reads");
        let height = frame_height_of(&sidecar).expect("a height");
        let life = screen_region(ScreenRegion::Life, 1920, height).expect("a fixed Life box");
        let difficulty =
            screen_region(ScreenRegion::AreaDifficulty, 1920, height).expect("a fixed box");
        for (text, area) in sidecar_lines(&sidecar).expect("lines") {
            let at = middle(area);
            assert!(
                !inside(life, at) && !inside(difficulty, at),
                "{file}: {text:?} is inside a fixed box"
            );
        }
    }
}

#[test]
fn every_frame_is_1920_wide_and_the_heights_are_those_of_the_modes() {
    let heights: Vec<u32> = SCREEN_FIXTURES
        .iter()
        .map(|file| frame_height_of(&screen_sidecar(file).expect("sidecar")).expect("height"))
        .collect();
    assert_eq!(
        heights,
        [
            1056, 1080, 1056, 1080, 1056, 1080, 1080, 1920, 1080, 1111, 1056
        ]
    );
    let gold = screen_sidecar("select-with-hud-text").expect("sidecar");
    assert!(box_of(&gold["gold"]).is_ok());
}
