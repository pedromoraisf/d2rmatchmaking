//! The committed character fixtures are what `draw-fixture characters` renders from their sidecars, byte for byte, and every
//! sidecar names only regions the reader knows (CHR-04, CHR-06, CHR-18).

use std::fs;

use xtask::character_fixture::{
    CHARACTER_FIXTURES, character_fixture_dir, character_sidecar, render_character_png,
    sidecar_keys,
};

#[test]
fn character_fixtures_are_reproducible() {
    for fixture in &CHARACTER_FIXTURES {
        let file = format!("{}.png", fixture.file);
        let committed = fs::read(character_fixture_dir().join(&file)).unwrap_or_else(|_| {
            panic!("{file} is committed; `cargo run -p xtask -- draw-fixture characters` writes it")
        });
        let rendered = render_character_png(fixture).expect("the character fixture renders");
        assert!(
            committed == rendered,
            "{file} is not what draw-fixture characters renders"
        );
    }
}

#[test]
fn character_sidecars_name_only_known_regions() {
    let known = sidecar_keys();
    for fixture in &CHARACTER_FIXTURES {
        let sidecar = character_sidecar(fixture).expect("the sidecar reads");
        for key in sidecar.keys() {
            assert!(
                known.contains(key),
                "{}.png.json names {key}, which is not a text region",
                fixture.file
            );
        }
    }
}

#[test]
fn the_fixtures_cover_the_selection_popup_in_game_automap_and_menu() {
    let files: Vec<&str> = CHARACTER_FIXTURES
        .iter()
        .map(|fixture| fixture.file)
        .collect();
    assert_eq!(
        files,
        [
            "select-normal",
            "select-titles",
            "select-full",
            "select-difficulty",
            "select-difficulty-dimmed",
            "in-game",
            "automap",
            "menu",
        ]
    );
}
