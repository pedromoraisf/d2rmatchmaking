//! The drawn character-screen fixtures (CHR-04, CHR-06, CHR-18): `cargo run -p xtask -- draw-fixture characters` draws each
//! screen of `apps/agent/fixtures/characters/` from its sidecar (`<png>.json`, the text of each region, keyed as
//! `ScreenRegion::key`), so a picture and the text it shows never differ. The regions are the domain's `screen_region` at
//! 1920×1080. The selected card's gold top border is drawn for the fixture's `selected` slot. Drawn with an openly
//! licensed font: the repository publishes no game asset.

use std::error::Error;
use std::fs;
use std::path::PathBuf;

use ab_glyph::FontRef;
use d2rmm_agent_domain::layout::{CARD_SLOTS, ScreenRegion, screen_region, screen_text_regions};
use d2rmm_agent_domain::vision::Region;
use serde_json::{Map, Value};

use crate::fixture::{FONT, HEIGHT, WIDTH, baseline_of, draw_centred, draw_line_in, encode};
use crate::repo_root;

const BACKGROUND: [u8; 4] = [30, 28, 26, 255];
const CARD_INTERIOR: [u8; 3] = [38, 36, 33];
const GREY_BORDER: [u8; 3] = [108, 108, 105];
const GOLD_BORDER: [u8; 3] = [227, 201, 97];
const NAME_INK: [u8; 3] = [236, 226, 196];
const TITLE_INK: [u8; 3] = [196, 166, 96];
const LEVEL_INK: [u8; 3] = [200, 160, 80];
const POPUP_FILL: [u8; 3] = [34, 30, 26];
const POPUP_EDGE: [u8; 3] = [120, 100, 60];
const BUTTON_FILL: [u8; 3] = [70, 62, 52];
/// An enabled popup label, as bright as the maintainer's (the brightest pixels of Normal, Nightmare and Hell read 246).
const POPUP_INK: [u8; 3] = [255, 246, 243];
/// A dimmed popup label: about 40% of `POPUP_INK`, under the 148 that an enabled label reaches (`ENABLED_LABEL_LUMA`).
const DIMMED_INK: [u8; 3] = [100, 96, 92];
const HUD_INK: [u8; 3] = [236, 226, 196];
const AREA_INK: [u8; 3] = [170, 140, 255];

/// One drawn screen: its file stem, the slot whose card is selected (its top border is gold), if any, and the popup labels
/// drawn dim (a difficulty the character does not have; their text is drawn too, so only the brightness tells them apart).
pub struct CharacterFixture {
    pub file: &'static str,
    pub selected: Option<u8>,
    pub dimmed: &'static [ScreenRegion],
}

/// The screens `draw-fixture characters` writes. The sidecars are committed next to them.
pub const CHARACTER_FIXTURES: [CharacterFixture; 8] = [
    CharacterFixture {
        file: "select-normal",
        selected: Some(0),
        dimmed: &[],
    },
    CharacterFixture {
        file: "select-titles",
        selected: Some(0),
        dimmed: &[],
    },
    CharacterFixture {
        file: "select-full",
        selected: Some(0),
        dimmed: &[],
    },
    CharacterFixture {
        file: "select-difficulty",
        selected: Some(0),
        dimmed: &[],
    },
    CharacterFixture {
        file: "select-difficulty-dimmed",
        selected: Some(0),
        dimmed: &[ScreenRegion::PopupNightmare, ScreenRegion::PopupHell],
    },
    CharacterFixture {
        file: "in-game",
        selected: None,
        dimmed: &[],
    },
    CharacterFixture {
        file: "automap",
        selected: None,
        dimmed: &[],
    },
    CharacterFixture {
        file: "menu",
        selected: None,
        dimmed: &[],
    },
];

/// The directory of the character fixtures, relative to the repository root.
pub fn character_fixture_dir() -> PathBuf {
    repo_root().join("apps/agent/fixtures/characters")
}

/// The sidecar of a fixture: the text of each region it shows.
pub fn character_sidecar(fixture: &CharacterFixture) -> Result<Map<String, Value>, Box<dyn Error>> {
    let path = character_fixture_dir().join(format!("{}.png.json", fixture.file));
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    match serde_json::from_str::<Value>(&text)? {
        Value::Object(map) => Ok(map),
        _ => Err(format!("{} is not an object", path.display()).into()),
    }
}

/// The keys a sidecar may hold: every text region, as `ScreenRegion::key` names it.
pub fn sidecar_keys() -> Vec<String> {
    screen_text_regions()
        .into_iter()
        .map(ScreenRegion::key)
        .collect()
}

fn text_of(sidecar: &Map<String, Value>, region: ScreenRegion) -> Option<&str> {
    sidecar.get(&region.key())?.as_str()
}

fn region(region: ScreenRegion) -> Result<Region, Box<dyn Error>> {
    screen_region(region, WIDTH, HEIGHT)
        .ok_or_else(|| format!("{region:?} has no region in the 1920×1080 frame").into())
}

fn fill(pixels: &mut [u8], x0: u32, y0: u32, x1: u32, y1: u32, colour: [u8; 3]) {
    for y in y0..y1.min(HEIGHT) {
        for x in x0..x1.min(WIDTH) {
            let at = ((y * WIDTH + x) * 4) as usize;
            pixels[at..at + 3].copy_from_slice(&colour);
            pixels[at + 3] = 255;
        }
    }
}

fn fill_region(pixels: &mut [u8], area: Region, colour: [u8; 3]) {
    fill(
        pixels,
        area.x,
        area.y,
        area.x + area.width,
        area.y + area.height,
        colour,
    );
}

fn draw_left(
    pixels: &mut [u8],
    font: &FontRef<'_>,
    text: &str,
    size: f32,
    area: Region,
    colour: [u8; 3],
) {
    draw_line_in(
        pixels,
        font,
        text,
        size,
        area.x as f32,
        baseline_of(area, size),
        colour,
    );
}

/// The selection screen's cards: each occupied slot is a frame with its title, name and level, and the selected frame's
/// top border is gold.
fn draw_cards(
    pixels: &mut [u8],
    font: &FontRef<'_>,
    sidecar: &Map<String, Value>,
    selected: Option<u8>,
) -> Result<(), Box<dyn Error>> {
    for slot in 0..CARD_SLOTS {
        let occupied = [
            ScreenRegion::CardTitle(slot),
            ScreenRegion::CardName(slot),
            ScreenRegion::CardLevel(slot),
        ]
        .into_iter()
        .any(|field| text_of(sidecar, field).is_some());
        if !occupied {
            continue;
        }
        let top = region(ScreenRegion::CardSelected(slot))?;
        let level = region(ScreenRegion::CardLevel(slot))?;
        let name = region(ScreenRegion::CardName(slot))?;
        let x0 = name.x.saturating_sub(14);
        let x1 = name.x + name.width + 14;
        let y1 = level.y + level.height + 6;
        let border = if selected == Some(slot) {
            GOLD_BORDER
        } else {
            GREY_BORDER
        };
        fill(pixels, x0, top.y, x1, top.y + top.height, border);
        fill(pixels, x0, top.y + top.height, x1, y1, CARD_INTERIOR);
        if let Some(title) = text_of(sidecar, ScreenRegion::CardTitle(slot)) {
            draw_left(
                pixels,
                font,
                title,
                15.0,
                region(ScreenRegion::CardTitle(slot))?,
                TITLE_INK,
            );
        }
        if let Some(text) = text_of(sidecar, ScreenRegion::CardName(slot)) {
            draw_left(pixels, font, text, 19.0, name, NAME_INK);
        }
        if let Some(text) = text_of(sidecar, ScreenRegion::CardLevel(slot)) {
            draw_left(pixels, font, text, 15.0, level, LEVEL_INK);
        }
    }
    Ok(())
}

/// The "Select Difficulty" popup: a box over the centre, its title and three buttons.
fn draw_popup(
    pixels: &mut [u8],
    font: &FontRef<'_>,
    sidecar: &Map<String, Value>,
    dimmed: &[ScreenRegion],
) -> Result<(), Box<dyn Error>> {
    let title = region(ScreenRegion::SelectDifficulty)?;
    let normal = region(ScreenRegion::PopupNormal)?;
    let hell = region(ScreenRegion::PopupHell)?;
    let x0 = normal.x.saturating_sub(12);
    let x1 = normal.x + normal.width + 12;
    let y0 = title.y.saturating_sub(14);
    let y1 = hell.y + hell.height + 14;
    fill(pixels, x0, y0, x1, y1, POPUP_EDGE);
    fill(pixels, x0 + 2, y0 + 2, x1 - 2, y1 - 2, POPUP_FILL);
    if let Some(text) = text_of(sidecar, ScreenRegion::SelectDifficulty) {
        draw_centred(pixels, font, text, 17.0, title, GOLD_BORDER);
    }
    for button in [
        ScreenRegion::PopupNormal,
        ScreenRegion::PopupNightmare,
        ScreenRegion::PopupHell,
    ] {
        let area = region(button)?;
        fill_region(
            pixels,
            Region {
                x: area.x.saturating_sub(4),
                y: area.y.saturating_sub(4),
                width: area.width + 8,
                height: area.height + 8,
            },
            BUTTON_FILL,
        );
        if let Some(text) = text_of(sidecar, button) {
            let ink = if dimmed.contains(&button) {
                DIMMED_INK
            } else {
                POPUP_INK
            };
            // Four passes a pixel apart make the strokes as heavy as the game's bold labels; one thin pass reads too dim.
            for offset in [0, 1, 2, 3] {
                let shifted = Region {
                    x: area.x + offset,
                    ..area
                };
                draw_centred(pixels, font, text, 20.0, shifted, ink);
            }
        }
    }
    Ok(())
}

/// The PNG of one screen, drawn from its sidecar. Deterministic: the same font, sidecar and encoder give the same bytes.
pub fn render_character_png(fixture: &CharacterFixture) -> Result<Vec<u8>, Box<dyn Error>> {
    let sidecar = character_sidecar(fixture)?;
    let mut pixels = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    let (rgba, _remainder) = pixels.as_chunks_mut::<4>();
    for pixel in rgba {
        pixel.copy_from_slice(&BACKGROUND);
    }
    let font =
        FontRef::try_from_slice(FONT).map_err(|_| "the fixture font is not a readable font")?;
    draw_cards(&mut pixels, &font, &sidecar, fixture.selected)?;
    if let Some(text) = text_of(&sidecar, ScreenRegion::CreateNew) {
        draw_centred(
            &mut pixels,
            &font,
            text,
            17.0,
            region(ScreenRegion::CreateNew)?,
            NAME_INK,
        );
    }
    if let Some(text) = text_of(&sidecar, ScreenRegion::Life) {
        draw_left(
            &mut pixels,
            &font,
            text,
            16.0,
            region(ScreenRegion::Life)?,
            HUD_INK,
        );
    }
    if let Some(text) = text_of(&sidecar, ScreenRegion::AreaDifficulty) {
        draw_left(
            &mut pixels,
            &font,
            text,
            13.0,
            region(ScreenRegion::AreaDifficulty)?,
            AREA_INK,
        );
    }
    if sidecar.contains_key(&ScreenRegion::SelectDifficulty.key()) {
        draw_popup(&mut pixels, &font, &sidecar, fixture.dimmed)?;
    }
    encode(&pixels)
}

/// Writes every character fixture (`<file>.png`) into `character_fixture_dir`. The sidecars are read, never written.
pub fn draw_character_fixtures() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let dir = character_fixture_dir();
    let mut written = Vec::new();
    for fixture in &CHARACTER_FIXTURES {
        let image = dir.join(format!("{}.png", fixture.file));
        fs::write(&image, render_character_png(fixture)?)?;
        written.push(image);
    }
    Ok(written)
}
