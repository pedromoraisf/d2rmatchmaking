//! The maintainer's Windows OCR check of the screenshots in one folder (apps/agent/README.md, "The Party panel check"). The
//! `ocr_check` test (adapters/windows_ocr.rs) and the standalone `ocr-check.exe` (examples/ocr-check.rs) both call
//! `check_folder`, so both read the five files with the same production reading code. The screenshots are the
//! maintainer's own: nothing here commits, copies or keeps them (ADR 010: the agent reads only the files it is given).
use std::path::Path;
use std::sync::Arc;

use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::ports::{FrameReader, ReadError, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::characters::{Class, Difficulty, Title};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
use d2rmm_agent_domain::presence::Screen;

/// The five screenshots the check reads, in the order it prints them: three Party frames, then the selection screen and its
/// difficulty popup. `scripts/agent/ocr-check.mjs` names the same five files.
pub const SCREENSHOTS: [&str; 5] = [
    "maintainer-party-revealed.png",
    "maintainer-party-revealed-tooltip.png",
    "maintainer-party-masked.png",
    "maintainer-select-screen.png",
    "maintainer-select-difficulty.png",
];

/// The room's name the maintainer's Party screenshots show when the name is revealed.
const PARTY_ROOM_NAME: &str = "DUEL NK LOCKS";

/// A card as the character checks compare it: name, class, level and title.
pub type Card = (&'static str, Class, u8, Option<Title>);

/// The first two cards of the maintainer's selection screen (2026-11-10): a titled Matriarch and an untitled Sorceress.
pub const MAINTAINER_CARDS: [Card; 2] = [
    ("vukVuka", Class::Sorceress, 88, Some(Title::Matriarch)),
    ("vukaDao", Class::Sorceress, 11, None),
];

/// A PNG, decoded to RGBA8. The error names what failed, so the check prints it for the file.
pub fn read_screenshot(path: &Path) -> Result<Rgba, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("cannot be read: {error}"))?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes))
        .read_info()
        .map_err(|error| format!("is not a PNG: {error}"))?;
    let mut pixels = vec![
        0;
        decoder
            .output_buffer_size()
            .ok_or_else(|| "is too large to decode".to_string())?
    ];
    let info = decoder
        .next_frame(&mut pixels)
        .map_err(|error| format!("does not decode: {error}"))?;
    Ok(Rgba {
        width: info.width,
        height: info.height,
        pixels,
    })
}

/// A committed PNG, decoded to RGBA8. Used by the tests, where a committed image that does not decode is a bug.
pub fn decode_png(path: &str) -> Rgba {
    read_screenshot(Path::new(path)).expect("the committed image decodes")
}

/// The text of one Party panel region, read with `reader`.
fn read_panel(reader: &dyn TextReader, image: &Rgba, panel: PanelRegion) -> Result<String, String> {
    let region = panel_region(panel, image.width, image.height).ok_or_else(|| {
        format!(
            "the Party panel layout is unknown for a {}x{} screenshot",
            image.width, image.height
        )
    })?;
    reader
        .read(image, region)
        .map(|read| read.text)
        .map_err(|error: ReadError| format!("the region does not read: {error:?}"))
}

/// Reads one Party frame: the panel must be open, and the Game Name field must read as `expected` for the room's name
/// `expected_name`. The error names what was read, so a failure shows the OCR text.
pub fn check_party(
    reader: &dyn TextReader,
    image: &Rgba,
    expected_name: &str,
    expected: FieldRead,
) -> Result<(), String> {
    let language = LanguagePack::english();
    let title = read_panel(reader, image, PanelRegion::PartyTitle)?;
    let label = read_panel(reader, image, PanelRegion::GameNameLabel)?;
    let field = read_panel(reader, image, PanelRegion::GameNameField)?;
    let read = format!("title {title:?}, label {label:?}, field {field:?}");
    if !language.party_panel_open(&title, &label) {
        return Err(format!("the panel is not open: {read}"));
    }
    let got = read_field(&field, expected_name);
    if got == expected {
        Ok(())
    } else {
        Err(format!(
            "the field is {got:?}, expected {expected:?}: {read}"
        ))
    }
}

/// Checks one character frame: its screen, and its cards in order. The error names what was read.
pub fn check_screen(reading: &FrameReading, screen: Screen, cards: &[Card]) -> Result<(), String> {
    if reading.screen != screen {
        return Err(format!(
            "the screen is {:?}, expected {screen:?}",
            reading.screen
        ));
    }
    let listed: Vec<String> = reading
        .cards
        .iter()
        .map(|card| {
            format!(
                "{} {:?} {} {:?}",
                card.name(),
                card.class(),
                card.level(),
                card.title()
            )
        })
        .collect();
    let wanted: Vec<String> = cards
        .iter()
        .map(|(name, class, level, title)| format!("{name} {class:?} {level} {title:?}"))
        .collect();
    if listed == wanted {
        Ok(())
    } else {
        Err(format!("the cards are {listed:?}, expected {wanted:?}"))
    }
}

/// The verdict of one screenshot, by its file name. A file the check does not know has no verdict.
fn verdict(
    name: &str,
    reader: &dyn TextReader,
    screens: &ScreenReader,
    image: &Rgba,
) -> Result<(), String> {
    match name {
        "maintainer-party-revealed.png" | "maintainer-party-revealed-tooltip.png" => {
            check_party(reader, image, PARTY_ROOM_NAME, FieldRead::Matched)
        }
        "maintainer-party-masked.png" => {
            check_party(reader, image, PARTY_ROOM_NAME, FieldRead::Masked)
        }
        "maintainer-select-screen.png" => check_screen(
            &screens.read(image),
            Screen::CharacterSelect,
            &MAINTAINER_CARDS,
        ),
        "maintainer-select-difficulty.png" => {
            let reading = screens.read(image);
            check_screen(&reading, Screen::CharacterSelect, &MAINTAINER_CARDS)?;
            let matriarch = reading
                .cards
                .first()
                .map(|card| card.unlocked_difficulties());
            if matriarch
                == Some(vec![
                    Difficulty::Normal,
                    Difficulty::Nightmare,
                    Difficulty::Hell,
                ])
            {
                Ok(())
            } else {
                Err(format!("the popup's difficulties are {matriarch:?}"))
            }
        }
        _ => Err(format!("{name} has no check")),
    }
}

/// Reads the five screenshots in `dir` with `reader`, prints one PASS or FAIL line per file with what the engine read, and
/// returns the failed file names. A missing file is a failure that names the file. Every file is read before the result is
/// returned, so one run shows every mismatch.
pub fn check_folder(
    dir: &Path,
    reader: Arc<dyn TextReader + Send + Sync>,
) -> Result<(), Vec<String>> {
    if !dir.is_dir() {
        println!("FAIL {}: is not a folder", dir.display());
        return Err(vec![dir.display().to_string()]);
    }
    let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
    let mut failed = Vec::new();
    for name in SCREENSHOTS {
        let path = dir.join(name);
        let result = if path.is_file() {
            read_screenshot(&path).and_then(|image| verdict(name, &*reader, &screens, &image))
        } else {
            Err(format!("is missing from {}", dir.display()))
        };
        match result {
            Ok(()) => println!("PASS {name}"),
            Err(error) => {
                println!("FAIL {name}: {error}");
                failed.push(name.to_string());
            }
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed)
    }
}
