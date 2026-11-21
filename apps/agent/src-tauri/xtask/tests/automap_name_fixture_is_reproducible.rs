//! The committed automap-name fixtures are what `draw-fixture automap-name` renders, byte for byte, with the sidecars it writes
//! (game-name-reading GNR-06, GNR-09), and each draws its name line inside the band the agent reads, where the name line is
//! found by its shape.

use std::fs;

use d2rmm_agent_domain::anchors::find_name_line;
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
use d2rmm_agent_domain::vision::TextLine;
use xtask::automap_name_fixture::{
    ACTIVITIES, CODES, automap_fixtures, automap_name_dir, automap_sidecar, render_automap_png,
};

#[test]
fn automap_name_fixtures_are_reproducible() {
    for fixture in automap_fixtures() {
        let name = format!("{}.png", fixture.file);
        let committed = fs::read(automap_name_dir().join(&name)).unwrap_or_else(|_| {
            panic!(
                "{name} is committed; `cargo run -p xtask -- draw-fixture automap-name` writes it"
            )
        });
        let rendered = render_automap_png(&fixture).expect("the automap fixture renders");
        assert!(
            committed == rendered,
            "{name} is not what draw-fixture automap-name renders"
        );
        let sidecar = format!("{name}.json");
        let held = fs::read_to_string(automap_name_dir().join(&sidecar))
            .unwrap_or_else(|_| panic!("{sidecar} is committed"));
        assert_eq!(held, automap_sidecar(&fixture), "{sidecar} holds the lines");
    }
}

#[test]
fn there_is_a_frame_per_activity_and_code_and_the_named_layouts() {
    let files: Vec<String> = automap_fixtures().into_iter().map(|f| f.file).collect();
    for activity in ACTIVITIES {
        for code in CODES {
            assert!(files.contains(&format!("automap-{activity}{code}")));
        }
    }
    for file in [
        "automap-en-1033",
        "automap-pt-1045",
        "automap-other-room",
        "automap-no-name",
    ] {
        assert!(files.iter().any(|held| held == file), "{file}");
    }
    assert_eq!(files.len(), 18 + 4);
}

fn lines_of(fixture: &xtask::automap_name_fixture::AutomapFixture) -> Vec<TextLine> {
    fixture
        .lines
        .iter()
        .map(|(text, region)| TextLine {
            text: text.clone(),
            region: *region,
        })
        .collect()
}

#[test]
fn every_name_sits_in_the_name_band_and_is_found_by_its_shape() {
    for fixture in automap_fixtures() {
        let lines = lines_of(&fixture);
        let found = find_name_line(&lines);
        if fixture.file == "automap-no-name" {
            assert_eq!(found, None);
            continue;
        }
        let found = found.unwrap_or_else(|| panic!("{} shows a name", fixture.file));
        let band = screen_region(ScreenRegion::AutomapName, 1920, fixture.height)
            .expect("the band resolves");
        let region = found.region;
        assert!(
            band.x <= region.x
                && region.right() <= band.right()
                && band.y <= region.y
                && region.bottom() <= band.bottom(),
            "{}",
            fixture.file
        );
    }
}

#[test]
fn each_name_is_its_own_rooms_and_no_other() {
    for fixture in automap_fixtures() {
        let Some(found) = find_name_line(&lines_of(&fixture)) else {
            continue;
        };
        assert_eq!(
            read_field(&found.text, &found.text.to_lowercase()),
            FieldRead::Matched
        );
        assert_eq!(read_field(&found.text, "mmbaalh-12"), {
            if found.text.eq_ignore_ascii_case("mmbaalh-12") {
                FieldRead::Matched
            } else {
                FieldRead::Other
            }
        });
    }
}
