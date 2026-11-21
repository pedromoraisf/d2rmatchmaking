//! The drawn per-mode screen fixtures (screen-recognition SCR-01, SCR-03, SCR-07, SCR-08):
//! `cargo run -p xtask -- draw-fixture screens` draws each screen of `apps/agent/fixtures/screens/` from its sidecar
//! (`<png>.json`). A sidecar holds the frame's `height` (the width is always 1920), the `lines` it shows (text and box, and
//! an optional `ink` for a dim line), and for a selection screen the `createNew` marker and the `gold` border. The client
//! heights are those of a window (1056) and of full screen (1080); the boxes are drawn where the fixed reading boxes do not
//! reach, so these screens are read only by the word search. Drawn with an openly licensed font: the repository publishes
//! no game asset, and no real print is ever committed.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use ab_glyph::FontRef;
use serde_json::Value;

use crate::character_fixture::{BACKGROUND, GOLD_BORDER, NAME_INK, draw_left};
use crate::fixture::{FONT, WIDTH, encode};
use crate::fullscreen_fixture::{box_of, sidecar_lines};
use crate::repo_root;

/// The screens `draw-fixture screens` writes, by file stem. The sidecars are committed next to them.
pub const SCREEN_FIXTURES: [&str; 11] = [
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
];

/// The directory of the screen fixtures, relative to the repository root.
pub fn screen_fixture_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/screens")
}

/// The sidecar of a fixture, parsed.
pub fn screen_sidecar(file: &str) -> Result<Value, Box<dyn Error>> {
    let path = screen_fixture_dir().join(format!("{file}.png.json"));
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    Ok(serde_json::from_str(&text)?)
}

/// The frame height a sidecar names.
pub fn frame_height_of(sidecar: &Value) -> Result<u32, Box<dyn Error>> {
    sidecar["height"]
        .as_u64()
        .and_then(|height| u32::try_from(height).ok())
        .ok_or_else(|| "the sidecar has no numeric height".into())
}

/// The offset of the client area inside the frame, when the sidecar names a `client` rectangle; (0, 0) otherwise.
fn client_offset(sidecar: &Value) -> (u32, u32) {
    let number = |key: &str| {
        sidecar["client"][key]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0)
    };
    (number("x"), number("y"))
}

/// The ink a line is drawn in: its `ink` triple, or the name ink.
fn ink_of(line: &Value) -> [u8; 3] {
    let Some(triple) = line.get("ink").and_then(Value::as_array) else {
        return NAME_INK;
    };
    let channel = |at: usize| {
        triple
            .get(at)
            .and_then(Value::as_u64)
            .and_then(|value| u8::try_from(value).ok())
            .unwrap_or(0)
    };
    [channel(0), channel(1), channel(2)]
}

/// The PNG of one screen, drawn from its sidecar. Deterministic: the same font, sidecar and encoder give the same bytes.
pub fn render_screen_png(file: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let sidecar = screen_sidecar(file)?;
    let height = frame_height_of(&sidecar)?;
    let mut pixels = vec![0u8; (WIDTH * height * 4) as usize];
    let (rgba, _remainder) = pixels.as_chunks_mut::<4>();
    for pixel in rgba {
        pixel.copy_from_slice(&BACKGROUND);
    }
    let font =
        FontRef::try_from_slice(FONT).map_err(|_| "the fixture font is not a readable font")?;
    if let Some(gold) = sidecar.get("gold") {
        let area = box_of(gold)?;
        for y in area.y..(area.y + area.height).min(height) {
            for x in area.x..(area.x + area.width).min(WIDTH) {
                let at = ((y * WIDTH + x) * 4) as usize;
                pixels[at..at + 3].copy_from_slice(&GOLD_BORDER);
            }
        }
    }
    let raw_lines = sidecar
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // A frame that holds a title bar (capture-cascade): the lines are in client coordinates and are drawn below the bar, at the
    // client's offset; the `chrome` lines (the title) are drawn where they say, outside the client.
    let (client_x, client_y) = client_offset(&sidecar);
    for ((text, mut area), line) in sidecar_lines(&sidecar)?.into_iter().zip(&raw_lines) {
        area.x += client_x;
        area.y += client_y;
        draw_left(&mut pixels, &font, &text, 18.0, area, ink_of(line));
    }
    let chrome = Value::Object(
        [(
            "lines".to_string(),
            sidecar.get("chrome").cloned().unwrap_or(Value::Null),
        )]
        .into_iter()
        .collect(),
    );
    let raw_chrome = chrome
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for ((text, area), line) in sidecar_lines(&chrome)?.into_iter().zip(&raw_chrome) {
        draw_left(&mut pixels, &font, &text, 18.0, area, ink_of(line));
    }
    encode(&pixels)
}

/// Writes every screen fixture (`<file>.png`) into `screen_fixture_dir`. The sidecars are read, never written.
pub fn draw_screen_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = screen_fixture_dir();
    let mut written = Vec::new();
    for file in SCREEN_FIXTURES {
        let image = dir.join(format!("{file}.png"));
        fs::write(&image, render_screen_png(file)?)?;
        written.push(image);
    }
    Ok(written)
}
