//! The drawn full-screen fixtures: `cargo run -p xtask -- draw-fixture fullscreen` draws each screen of
//! `apps/agent/fixtures/fullscreen/` from its sidecar (`<png>.json`) at 1920×1080. A full-screen client draws the panels at
//! other offsets than the maximized 1920×1033 one that `layout`'s fixed boxes were measured on (0.1.3), so these sidecars
//! hold lines with a box each, at the positions measured on the maintainer's full-screen prints: the selection screen with
//! the ONLINE/OFFLINE tab, a titled and an untitled card; the same with the Select Difficulty popup open; the Party panel
//! with the game name revealed. A `gold` box is the selected card's top border. Drawn with an openly licensed font: the
//! repository publishes no game asset, and no real print is ever committed.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use ab_glyph::FontRef;
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
use d2rmm_agent_domain::vision::Region;
use serde_json::Value;

use crate::character_fixture::{BACKGROUND, GOLD_BORDER, NAME_INK, POPUP_INK, draw_left, fill};
use crate::fixture::{FONT, HEIGHT, WIDTH, encode};
use crate::repo_root;

/// The screens `draw-fixture fullscreen` writes, by file stem. The sidecars are committed next to them.
pub const FULLSCREEN_FIXTURES: [&str; 3] = ["select", "difficulty", "party"];

/// The directory of the full-screen fixtures, relative to the repository root.
pub fn fullscreen_fixture_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/fullscreen")
}

/// The sidecar of a fixture, parsed.
pub fn fullscreen_sidecar(file: &str) -> Result<Value, Box<dyn Error>> {
    let path = fullscreen_fixture_dir().join(format!("{file}.png.json"));
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    Ok(serde_json::from_str(&text)?)
}

/// The box a sidecar entry holds (`x`, `y`, `width`, `height`).
pub fn box_of(value: &Value) -> Result<Region, Box<dyn Error>> {
    let get = |key: &str| -> Result<u32, Box<dyn Error>> {
        value[key]
            .as_u64()
            .and_then(|number| u32::try_from(number).ok())
            .ok_or_else(|| format!("{key} is not a number in {value}").into())
    };
    Ok(Region {
        x: get("x")?,
        y: get("y")?,
        width: get("width")?,
        height: get("height")?,
    })
}

/// The lines of a sidecar: text and box, top to bottom as listed.
pub fn sidecar_lines(sidecar: &Value) -> Result<Vec<(String, Region)>, Box<dyn Error>> {
    let Some(lines) = sidecar.get("lines").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    lines
        .iter()
        .map(|line| {
            let text = line["text"]
                .as_str()
                .ok_or_else(|| format!("a line has no text: {line}"))?;
            Ok((text.to_string(), box_of(line)?))
        })
        .collect()
}

/// Whether a line is a popup word, drawn as bright as an enabled popup label.
fn is_popup_word(text: &str) -> bool {
    ["select difficulty", "normal", "nightmare", "hell"].contains(&text.to_lowercase().as_str())
}

/// The PNG of one screen, drawn from its sidecar. Deterministic: the same font, sidecar and encoder give the same bytes.
pub fn render_fullscreen_png(file: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let sidecar = fullscreen_sidecar(file)?;
    let mut pixels = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    let (rgba, _remainder) = pixels.as_chunks_mut::<4>();
    for pixel in rgba {
        pixel.copy_from_slice(&BACKGROUND);
    }
    let font =
        FontRef::try_from_slice(FONT).map_err(|_| "the fixture font is not a readable font")?;
    if let Some(gold) = sidecar.get("gold") {
        let area = box_of(gold)?;
        fill(
            &mut pixels,
            area.x,
            area.y,
            area.x + area.width,
            area.y + area.height,
            GOLD_BORDER,
        );
    }
    for (text, area) in sidecar_lines(&sidecar)? {
        let ink = if is_popup_word(&text) {
            POPUP_INK
        } else {
            NAME_INK
        };
        draw_left(&mut pixels, &font, &text, 18.0, area, ink);
    }
    if let Some(text) = sidecar.get("createNew").and_then(Value::as_str) {
        let area = screen_region(ScreenRegion::CreateNew, WIDTH, HEIGHT)
            .ok_or("CreateNew has no region in the 1920×1080 frame")?;
        draw_left(&mut pixels, &font, text, 18.0, area, NAME_INK);
    }
    encode(&pixels)
}

/// Writes every full-screen fixture (`<file>.png`) into `fullscreen_fixture_dir`. The sidecars are read, never written.
pub fn draw_fullscreen_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = fullscreen_fixture_dir();
    let mut written = Vec::new();
    for file in FULLSCREEN_FIXTURES {
        let image = dir.join(format!("{file}.png"));
        fs::write(&image, render_fullscreen_png(file)?)?;
        written.push(image);
    }
    Ok(written)
}
