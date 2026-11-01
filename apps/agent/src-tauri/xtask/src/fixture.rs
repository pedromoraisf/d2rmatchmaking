//! The F0 reference image of the game name (AD-047, AD-070): a synthetic 1920×1080 automap frame drawn with an openly
//! licensed font, so the repository publishes no game asset. The game name is drawn inside the built-in region
//! `AUTOMAP_NAME_1080P`; `cargo run -p xtask -- draw-fixture` writes `apps/agent/fixtures/automap-game-name.png`.

use std::error::Error;
use std::path::PathBuf;

use ab_glyph::{Font, FontRef, PxScale, ScaleFont, point};
use d2rmm_agent_core::vision::AUTOMAP_NAME_1080P;

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

fn encode(pixels: &[u8]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, WIDTH, HEIGHT);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(pixels)?;
    Ok(out)
}
