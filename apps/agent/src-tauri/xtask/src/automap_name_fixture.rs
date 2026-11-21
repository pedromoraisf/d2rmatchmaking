//! The drawn automap fixtures with a game name (game-name-reading GNR-06, GNR-09): `cargo run -p xtask -- draw-fixture
//! automap-name` draws each frame of `apps/agent/fixtures/automap-name/` and its sidecar (`<png>.json`, the lines with their
//! boxes, the shape the headless agent reads). The top-right text column of the automap holds a line `<label>: <name>`; the
//! drawn line sits at the position `ocr-real` measured on the maintainer's English print (1920×1033: x 1735, y 34, 155×13)
//! scaled to the frame's height, with the difficulty line under it. One frame per generated activity and difficulty code,
//! the English and Portuguese layouts, another room's name and a frame with no name. Drawn with an openly licensed font: the
//! repository publishes no game asset, and no real print is ever committed.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use d2rmm_agent_domain::vision::Region;
use serde_json::json;

use crate::repo_root;
use crate::screen_fixture::render_lines_png;

/// The generated activities and difficulty codes of ADR 017 (the API's vocabulary; a harness test keeps them equal).
pub const ACTIVITIES: [&str; 6] = ["baal", "chaos", "cows", "tz", "heralds", "pvp"];
pub const CODES: [&str; 3] = ["n", "m", "h"];

/// One drawn automap frame: its file stem, the frame's height and its lines (text and box).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutomapFixture {
    pub file: String,
    pub height: u32,
    pub lines: Vec<(String, Region)>,
}

/// The line `<label>: <name>` at the measured position, scaled from the 1033 client to `height`.
fn name_line(label: &str, name: &str, height: u32) -> (String, Region) {
    let at = |reference: u32| (reference * height + 516) / 1033;
    (
        format!("{label}: {name}"),
        Region {
            x: 1735,
            y: at(34),
            width: 155,
            height: at(13),
        },
    )
}

/// The difficulty line under the name line, so the frame is a real automap column and not a lone name.
fn difficulty_line(label: &str, height: u32) -> (String, Region) {
    let at = |reference: u32| (reference * height + 516) / 1033;
    (
        label.to_string(),
        Region {
            x: 1750,
            y: at(52),
            width: 150,
            height: at(16),
        },
    )
}

fn frame(file: &str, height: u32, lines: Vec<(String, Region)>) -> AutomapFixture {
    AutomapFixture {
        file: file.to_string(),
        height,
        lines,
    }
}

/// Every automap fixture, in a fixed order.
pub fn automap_fixtures() -> Vec<AutomapFixture> {
    let mut fixtures = Vec::new();
    for (index, activity) in ACTIVITIES.into_iter().enumerate() {
        for code in CODES {
            let name = format!("mm{activity}{code}-{}", index + 12);
            fixtures.push(frame(
                &format!("automap-{activity}{code}"),
                1080,
                vec![
                    name_line("Game", &name, 1080),
                    difficulty_line("Difficulty: Hell", 1080),
                ],
            ));
        }
    }
    // The two client layouts `ocr-real` measured: English at 1920×1033 and Portuguese at 1920×1045.
    fixtures.push(frame(
        "automap-en-1033",
        1033,
        vec![
            name_line("Game", "mmbaalh-19", 1033),
            difficulty_line("Difficulty: Hell", 1033),
        ],
    ));
    fixtures.push(frame(
        "automap-pt-1045",
        1045,
        vec![
            name_line("Jogo", "mmchaosh-20", 1045),
            difficulty_line("Dificuldade: Inferno", 1045),
        ],
    ));
    // Another room's name, and a frame whose column holds no name.
    fixtures.push(frame(
        "automap-other-room",
        1080,
        vec![
            name_line("Game", "mmbaalh-999", 1080),
            difficulty_line("Difficulty: Hell", 1080),
        ],
    ));
    fixtures.push(frame(
        "automap-no-name",
        1080,
        vec![difficulty_line("Difficulty: Hell", 1080)],
    ));
    fixtures
}

/// The directory of the automap-name fixtures, relative to the repository root.
pub fn automap_name_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/automap-name")
}

/// The sidecar of a fixture: its height and its lines with their boxes, pretty-printed with a final newline.
pub fn automap_sidecar(fixture: &AutomapFixture) -> String {
    let lines: Vec<_> = fixture
        .lines
        .iter()
        .map(|(text, area)| {
            json!({ "text": text, "x": area.x, "y": area.y, "width": area.width, "height": area.height })
        })
        .collect();
    let text = serde_json::to_string_pretty(&json!({ "height": fixture.height, "lines": lines }))
        .expect("a JSON object serialises");
    format!("{text}\n")
}

/// The PNG of a fixture, deterministic: the same font and lines give the same bytes.
pub fn render_automap_png(fixture: &AutomapFixture) -> Result<Vec<u8>, Box<dyn Error>> {
    render_lines_png(fixture.height, &fixture.lines)
}

/// Writes every fixture and its sidecar into `automap_name_dir`.
pub fn draw_automap_name_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = automap_name_dir();
    fs::create_dir_all(&dir)?;
    let mut written = Vec::new();
    for fixture in automap_fixtures() {
        let image = dir.join(format!("{}.png", fixture.file));
        fs::write(&image, render_automap_png(&fixture)?)?;
        let sidecar = dir.join(format!("{}.png.json", fixture.file));
        fs::write(&sidecar, automap_sidecar(&fixture))?;
        written.push(image);
        written.push(sidecar);
    }
    Ok(written)
}
