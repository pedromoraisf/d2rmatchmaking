//! The F0 reference image of the game name (AD-047, AD-070): a synthetic 1920×1080 automap frame drawn with an openly
//! licensed font, so the repository publishes no game asset. The game name is drawn inside the built-in region
//! `AUTOMAP_NAME_1080P`; `cargo run -p xtask -- draw-fixture` writes `apps/agent/fixtures/automap-game-name.png`.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use ab_glyph::{Font, FontRef, PxScale, ScaleFont, point};
use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
use d2rmm_agent_domain::vision::{AUTOMAP_NAME_1080P, Region};

use crate::repo_root;

pub const WIDTH: u32 = 1920;
pub const HEIGHT: u32 = 1080;

/// Source Sans 3, SIL Open Font License 1.1 (`apps/agent/fixtures/fonts/OFL.txt`).
const FONT: &[u8] = include_bytes!("../../../fixtures/fonts/SourceSans3-VF.ttf");
const BACKGROUND: [u8; 3] = [18, 16, 14];
const INK: [u8; 3] = [236, 226, 196];
const GAME_NAME: &str = "mmbaalh-12";
const DIFFICULTY: &str = "Difficulty: Hell";

/// The committed reference image, relative to the repository root.
pub fn fixture_path() -> PathBuf {
    repo_root().join("apps/agent/fixtures/automap-game-name.png")
}

/// The PNG bytes of the reference image. Deterministic: the same font and encoder give the same bytes.
pub fn render_png() -> Result<Vec<u8>, Box<dyn Error>> {
    let mut pixels = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    // The buffer is WIDTH * HEIGHT * 4 bytes, a multiple of 4, so the remainder is always empty.
    let (rgba, _remainder) = pixels.as_chunks_mut::<4>();
    for pixel in rgba {
        pixel[..3].copy_from_slice(&BACKGROUND);
        pixel[3] = 255;
    }
    let font =
        FontRef::try_from_slice(FONT).map_err(|_| "the fixture font is not a readable font")?;
    let region = AUTOMAP_NAME_1080P;
    let left = region.x as f32 + 12.0;
    draw_line(
        &mut pixels,
        &font,
        GAME_NAME,
        40.0,
        left,
        region.y as f32 + 54.0,
    );
    draw_line(
        &mut pixels,
        &font,
        DIFFICULTY,
        26.0,
        left,
        (region.y + region.height) as f32 + 40.0,
    );
    encode(&pixels)
}

fn draw_line(pixels: &mut [u8], font: &FontRef<'_>, text: &str, size: f32, x: f32, baseline: f32) {
    let scale = PxScale::from(size);
    let scaled = font.as_scaled(scale);
    let mut caret = x;
    for c in text.chars() {
        let id = font.glyph_id(c);
        let glyph = id.with_scale_and_position(scale, point(caret, baseline));
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let px = i64::from(bounds.min.x as i32) + i64::from(gx);
                let py = i64::from(bounds.min.y as i32) + i64::from(gy);
                if px < 0 || py < 0 || px >= i64::from(WIDTH) || py >= i64::from(HEIGHT) {
                    return;
                }
                let at = ((py as u32 * WIDTH + px as u32) * 4) as usize;
                for (channel, ink) in INK.iter().enumerate() {
                    let back = f32::from(pixels[at + channel]);
                    let front = f32::from(*ink);
                    pixels[at + channel] = (back + (front - back) * coverage).round() as u8;
                }
            });
        }
        caret += scaled.h_advance(id);
    }
}

/// A Party panel fixture (AGN-02, AGN-04): the field text the panel shows, drawn on a 1920×1080 frame at the panel's regions.
pub struct PartyFixture {
    pub file: &'static str,
    pub field: &'static str,
}

/// The fixtures `draw-fixture party` writes: the room's name revealed, the masked field, and another game's name.
pub const PARTY_FIXTURES: [PartyFixture; 3] = [
    PartyFixture {
        file: "party-revealed.png",
        field: "mmbaalh-12",
    },
    PartyFixture {
        file: "party-masked.png",
        field: "xxxxxxxxx",
    },
    PartyFixture {
        file: "party-other.png",
        field: "mmbaalh-999",
    },
];

/// The directory of the Party fixtures, relative to the repository root.
pub fn party_fixture_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/party")
}

/// The sidecar of a Party fixture: the text of each panel region, keyed by the region's name (`PanelRegion`, camelCase).
pub fn party_sidecar(field: &str) -> String {
    // Pretty-printed with a final newline, the form Prettier keeps for committed JSON.
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "partyTitle": "Party",
        "gameNameLabel": "Game Name",
        "gameNameField": field,
    }))
    .expect("a JSON object of strings serialises");
    format!("{text}\n")
}

/// The PNG of a Party fixture whose Game Name field shows `field`. Deterministic, like the F0 image.
pub fn render_party_png(field: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut pixels = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    let (rgba, _remainder) = pixels.as_chunks_mut::<4>();
    for pixel in rgba {
        pixel[..3].copy_from_slice(&BACKGROUND);
        pixel[3] = 255;
    }
    let font =
        FontRef::try_from_slice(FONT).map_err(|_| "the fixture font is not a readable font")?;
    let title = panel_region(PanelRegion::PartyTitle, WIDTH, HEIGHT)
        .ok_or("the 1920×1080 frame has the Party title region")?;
    let label = panel_region(PanelRegion::GameNameLabel, WIDTH, HEIGHT)
        .ok_or("the 1920×1080 frame has the Game Name label region")?;
    let entry = panel_region(PanelRegion::GameNameField, WIDTH, HEIGHT)
        .ok_or("the 1920×1080 frame has the Game Name field region")?;
    draw_centred(&mut pixels, &font, "Party", 26.0, title);
    draw_centred(&mut pixels, &font, "Game Name", 16.0, label);
    draw_line(
        &mut pixels,
        &font,
        field,
        22.0,
        entry.x as f32 + 14.0,
        baseline_of(entry, 22.0),
    );
    encode(&pixels)
}

/// Writes every Party fixture and its sidecar into `party_fixture_dir`.
pub fn draw_party_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = party_fixture_dir();
    fs::create_dir_all(&dir)?;
    let mut written = Vec::new();
    for fixture in &PARTY_FIXTURES {
        let image = dir.join(fixture.file);
        fs::write(&image, render_party_png(fixture.field)?)?;
        let sidecar = dir.join(format!("{}.json", fixture.file));
        fs::write(&sidecar, party_sidecar(fixture.field))?;
        written.push(image);
        written.push(sidecar);
    }
    Ok(written)
}

/// The baseline that centres a line of `size` pixels vertically in `region` (a cap height of about 0.7 em).
fn baseline_of(region: Region, size: f32) -> f32 {
    region.y as f32 + (region.height as f32 + size * 0.7) / 2.0
}

/// Draws `text` centred horizontally and vertically in `region`.
fn draw_centred(pixels: &mut [u8], font: &FontRef<'_>, text: &str, size: f32, region: Region) {
    let scale = PxScale::from(size);
    let scaled = font.as_scaled(scale);
    let width: f32 = text
        .chars()
        .map(|c| scaled.h_advance(font.glyph_id(c)))
        .sum();
    let left = region.x as f32 + (region.width as f32 - width) / 2.0;
    draw_line(pixels, font, text, size, left, baseline_of(region, size));
}

fn encode(pixels: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, WIDTH, HEIGHT);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(pixels)?;
    Ok(out)
}
