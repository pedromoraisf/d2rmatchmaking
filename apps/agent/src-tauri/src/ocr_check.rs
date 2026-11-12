//! The maintainer's Windows OCR check of the screenshots in one folder (apps/agent/README.md, "The Party panel check"). The
//! `ocr_check` test (adapters/windows_ocr.rs) and the standalone `ocr-check.exe` (examples/ocr-check.rs) both call
//! `check_folder`, so both read the five files with the same production reading code. The screenshots are the
//! maintainer's own: nothing here commits, copies or keeps them (ADR 010: the agent reads only the files it is given).
use std::path::Path;
use std::sync::Arc;

use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::ports::{FrameReader, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::characters::{Class, Difficulty, Title};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field_variants};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{PanelRegion, ScreenRegion, panel_region, screen_region};
use d2rmm_agent_domain::presence::Screen;
use d2rmm_agent_domain::vision::Region;

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

/// Every reading (OCR variant) of one Party panel region, read with `reader`.
fn read_panel(
    reader: &dyn TextReader,
    image: &Rgba,
    panel: PanelRegion,
) -> Result<Vec<String>, String> {
    let region = panel_region(panel, image.width, image.height).ok_or_else(|| {
        format!(
            "the Party panel layout is unknown for a {}x{} screenshot",
            image.width, image.height
        )
    })?;
    Ok(reader
        .read_variants(image, region)
        .into_iter()
        .map(|read| read.text)
        .collect())
}

/// Reads one Party frame: the panel must be open, and the Game Name field must read as `expected` for the room's name
/// `expected_name`, with the readings combined as the agent combines them (`read_field_variants`). The error names what was
/// read, so a failure shows the OCR text.
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
    if !title.iter().any(|read| language.party_panel_open(read)) {
        return Err(format!("the panel is not open: {read}"));
    }
    let fields: Vec<&str> = field.iter().map(String::as_str).collect();
    let got = read_field_variants(&fields, expected_name);
    if got == expected {
        Ok(())
    } else {
        Err(format!(
            "the field is {got:?}, expected {expected:?}: {read}"
        ))
    }
}

/// Checks one character frame: its screen, and its cards in order. Names are compared without case: the game draws them in
/// small caps, so the case of a name is not on the screen (decisions.md, 2026-11-12). The error names what was read.
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
                card.name().to_lowercase(),
                card.class(),
                card.level(),
                card.title()
            )
        })
        .collect();
    let wanted: Vec<String> = cards
        .iter()
        .map(|(name, class, level, title)| {
            format!("{} {class:?} {level} {title:?}", name.to_lowercase())
        })
        .collect();
    if listed == wanted {
        Ok(())
    } else {
        Err(format!("the cards are {listed:?}, expected {wanted:?}"))
    }
}

/// A region the check reads, for the diagnostics: its name and its rectangle in the screenshot (`None` when the layout has
/// none for that size).
type Spot = (String, Option<Region>);

/// The regions a screenshot's check reads, by file name: the Party title, label and field for a Party frame; for the
/// selection screen the "Create New" marker and, for each of the first two cards, the title line, the name and the
/// "Level N Class" line; the difficulty popup also its title and three labels.
fn spots(name: &str, width: u32, height: u32) -> Vec<Spot> {
    let panel = |label: &str, region| (label.to_string(), panel_region(region, width, height));
    let screen = |label: String, region| (label, screen_region(region, width, height));
    if name.starts_with("maintainer-party") {
        return vec![
            panel("Party title", PanelRegion::PartyTitle),
            panel("Game Name label", PanelRegion::GameNameLabel),
            panel("Game Name field", PanelRegion::GameNameField),
        ];
    }
    let mut regions = vec![screen("Create New".to_string(), ScreenRegion::CreateNew)];
    for slot in 0..2u8 {
        regions.push(screen(
            format!("card {slot} title line"),
            ScreenRegion::CardTitle(slot),
        ));
        regions.push(screen(
            format!("card {slot} name"),
            ScreenRegion::CardName(slot),
        ));
        regions.push(screen(
            format!("card {slot} class/level line"),
            ScreenRegion::CardLevel(slot),
        ));
    }
    if name == "maintainer-select-difficulty.png" {
        regions.push(screen(
            "popup title".to_string(),
            ScreenRegion::SelectDifficulty,
        ));
        regions.push(screen(
            "popup Normal".to_string(),
            ScreenRegion::PopupNormal,
        ));
        regions.push(screen(
            "popup Nightmare".to_string(),
            ScreenRegion::PopupNightmare,
        ));
        regions.push(screen("popup Hell".to_string(), ScreenRegion::PopupHell));
    }
    regions
}

/// The readers whose text the diagnostics print for each region, by label (nearest and bilinear at 2x, 3x, 4x and 5x); the agent
/// reads the six of 3x, 4x and 5x (characters-reading T24).
pub type Variants = Vec<(String, Arc<dyn TextReader + Send + Sync>)>;

/// The diagnostic lines of one screenshot, printed before its verdict: the image size, then for each region it reads the
/// rectangle (`x,y WxH`) and, one line per variant, the raw text that variant's engine returned. They never change what
/// counts as PASS.
pub fn diagnostics(name: &str, variants: &Variants, image: &Rgba) -> Vec<String> {
    let mut lines = vec![format!("  {name}: image {}x{}", image.width, image.height)];
    for (label, region) in spots(name, image.width, image.height) {
        let Some(area) = region else {
            lines.push(format!("  {label}: no region for this image size"));
            continue;
        };
        lines.push(format!(
            "  {label}: at {},{} size {}x{}",
            area.x, area.y, area.width, area.height
        ));
        for (variant, reader) in variants {
            let text = match reader.read(image, area) {
                Ok(read) => format!("{:?}", read.text),
                Err(error) => format!("does not read: {error:?}"),
            };
            lines.push(format!("    {variant}: {text}"));
        }
    }
    lines
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

/// Reads the five screenshots in `dir` with `reader` (the production reader: it alone decides PASS or FAIL) and prints, per
/// region, the text of each of `variants` (T14); prints one PASS or FAIL line per file with what the engine read, and
/// returns the failed file names. A missing file is a failure that names the file. Every file is read before the result is
/// returned, so one run shows every mismatch.
pub fn check_folder(
    dir: &Path,
    reader: Arc<dyn TextReader + Send + Sync>,
    variants: Variants,
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
            read_screenshot(&path).and_then(|image| {
                for line in diagnostics(name, &variants, &image) {
                    println!("{line}");
                }
                verdict(name, &*reader, &screens, &image)
            })
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
    use d2rmm_agent_domain::vision::{ReadText, Region};

    use super::{Variants, diagnostics};

    /// Returns its own tag and the region's x as the text, so a line shows which variant and region it came from.
    struct EchoReader(&'static str);

    impl TextReader for EchoReader {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: format!("{}{}", self.0, region.x),
                confidence: 1.0,
            })
        }
    }

    fn variants() -> Variants {
        vec![
            ("nearest 3x".to_string(), Arc::new(EchoReader("n"))),
            ("bilinear 3x".to_string(), Arc::new(EchoReader("b"))),
        ]
    }

    fn frame() -> Rgba {
        Rgba {
            width: 1920,
            height: 1033,
            pixels: Vec::new(),
        }
    }

    #[test]
    fn a_party_file_lists_its_size_and_each_region_with_a_line_per_variant() {
        let lines = diagnostics("maintainer-party-revealed.png", &variants(), &frame());
        assert_eq!(
            lines.len(),
            1 + 3 * 3,
            "size, then region + 2 variants, three times: {lines:?}"
        );
        assert_eq!(lines[0], "  maintainer-party-revealed.png: image 1920x1033");
        assert!(lines[1].starts_with("  Party title: at "), "{}", lines[1]);
        assert!(lines[2].starts_with("    nearest 3x: \"n"), "{}", lines[2]);
        assert!(lines[3].starts_with("    bilinear 3x: \"b"), "{}", lines[3]);
        assert!(
            lines[4].starts_with("  Game Name label: at "),
            "{}",
            lines[4]
        );
        assert!(
            lines[7].starts_with("  Game Name field: at "),
            "{}",
            lines[7]
        );
        assert!(lines[1].contains(" size "));
    }

    #[test]
    fn the_selection_screen_lists_the_marker_and_each_card_line_and_the_popup_adds_its_labels() {
        let select = diagnostics("maintainer-select-screen.png", &variants(), &frame());
        assert_eq!(
            select.len(),
            1 + (1 + 6) * 3,
            "size, marker and two cards of three lines"
        );
        let popup = diagnostics("maintainer-select-difficulty.png", &variants(), &frame());
        assert_eq!(
            popup.len(),
            select.len() + 4 * 3,
            "the popup title and three labels"
        );
        assert!(
            popup
                .iter()
                .any(|line| line.starts_with("  popup Hell: at "))
        );
    }

    #[test]
    fn a_size_without_a_layout_says_so() {
        let tiny = Rgba {
            width: 100,
            height: 100,
            pixels: Vec::new(),
        };
        let lines = diagnostics("maintainer-party-masked.png", &variants(), &tiny);
        assert!(
            lines[1].ends_with("no region for this image size"),
            "{}",
            lines[1]
        );
    }
}
