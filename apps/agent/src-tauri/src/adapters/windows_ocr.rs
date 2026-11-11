//! The Windows OCR reader (design.md § Vision and fusion; AGS-16, AGS-20). The engine is fixed to en-US. The crop is
//! copied into an in-process bitmap and read there, so no image and no text leaves the process. The WinRT calls are
//! safe wrappers; this file is one of the two that may allow unsafe code (ADR 010 policy).
#![allow(unsafe_code)]

use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
use d2rmm_agent_domain::vision::{ReadText, Region};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

use crate::adapters::ocr_pixels::scaled_bgra;

/// The scale a region is read at: nearest-neighbour, 3×, so the Party panel's text (about 12 px high) reaches the size the
/// engine reads. A decision of the agent-game-name feature, pinned by the maintainer's screenshots (windows test).
const OCR_SCALE: u32 = 3;

/// The one language the reader reads. The automap's game name is Latin text in English.
const LANGUAGE: &str = "en-US";

/// The Windows OCR engine for `en-US`. `new` fails when the engine is not installed; it never falls back to another.
pub struct WindowsOcr {
    engine: OcrEngine,
}

impl WindowsOcr {
    pub fn new() -> Result<Self, ReadError> {
        let language =
            Language::CreateLanguage(&LANGUAGE.into()).map_err(|_| ReadError::EngineUnavailable)?;
        let engine = OcrEngine::TryCreateFromLanguage(&language)
            .map_err(|_| ReadError::EngineUnavailable)?;
        Ok(Self { engine })
    }
}

impl TextReader for WindowsOcr {
    fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
        let bitmap = crop_to_bitmap(image, region)?;
        let result = self
            .engine
            .RecognizeAsync(&bitmap)
            .and_then(|operation| operation.join())
            .map_err(|_| ReadError::Failed)?;
        let text = result.Text().map_err(|_| ReadError::Failed)?.to_string();
        let confidence = if text.trim().is_empty() { 0.0 } else { 1.0 };
        Ok(ReadText { text, confidence })
    }
}

/// Copies the region, scaled up by `OCR_SCALE`, into a BGRA8 software bitmap (`ocr_pixels`).
fn crop_to_bitmap(image: &Rgba, region: Region) -> Result<SoftwareBitmap, ReadError> {
    let bgra = scaled_bgra(image, region, OCR_SCALE).ok_or(ReadError::Failed)?;
    let width = region.width * OCR_SCALE;
    let height = region.height * OCR_SCALE;
    let bitmap = SoftwareBitmap::Create(
        BitmapPixelFormat::Bgra8,
        i32::try_from(width).map_err(|_| ReadError::Failed)?,
        i32::try_from(height).map_err(|_| ReadError::Failed)?,
    )
    .map_err(|_| ReadError::Failed)?;
    let writer = DataWriter::new().map_err(|_| ReadError::Failed)?;
    writer.WriteBytes(&bgra).map_err(|_| ReadError::Failed)?;
    let buffer = writer.DetachBuffer().map_err(|_| ReadError::Failed)?;
    bitmap
        .CopyFromBuffer(&buffer)
        .map_err(|_| ReadError::Failed)?;
    Ok(bitmap)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::ports::{Rgba, TextReader};
    use d2rmm_agent_core::read_frame::read_game_name;
    use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
    use d2rmm_agent_domain::language::{GAME_NAME, LanguagePack, PARTY};
    use d2rmm_agent_domain::layout::{PanelRegion, panel_region};

    use super::WindowsOcr;

    /// The committed F0 reference image (AD-047), decoded to RGBA8.
    fn reference_image() -> Rgba {
        decode_png(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/automap-game-name.png"
        ))
    }

    /// A committed PNG, decoded to RGBA8.
    fn decode_png(path: &str) -> Rgba {
        let bytes = std::fs::read(path).expect("the committed image is readable");
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .expect("the committed image is a PNG");
        let mut pixels = vec![0; decoder.output_buffer_size().expect("the image size fits")];
        let info = decoder
            .next_frame(&mut pixels)
            .expect("the committed image decodes");
        Rgba {
            width: info.width,
            height: info.height,
            pixels,
        }
    }

    /// A Party screenshot of the maintainer, with the member list blurred (`fixtures/party`), decoded to RGBA8.
    fn party_screenshot(name: &str) -> Rgba {
        decode_png(&format!(
            "{}/../fixtures/party/{name}",
            env!("CARGO_MANIFEST_DIR")
        ))
    }

    /// The text of one panel region, read with the en-US engine.
    fn read_panel(reader: &WindowsOcr, image: &Rgba, panel: PanelRegion) -> String {
        let region = panel_region(panel, image.width, image.height)
            .expect("a 1920-wide screenshot has the panel layout");
        reader.read(image, region).expect("the region reads").text
    }

    /// Reads a revealed or masked Party screenshot: the panel is open, and the field shows `expected` (revealed) or the
    /// masked value. Fails, rather than skips, without the engine.
    fn assert_party_field(name: &str, expected: FieldRead) {
        let reader = WindowsOcr::new().expect(
            "the en-US Windows OCR engine is installed (this test fails, it never skips, without it)",
        );
        let image = party_screenshot(name);
        let language = LanguagePack::english();
        let title = read_panel(&reader, &image, PanelRegion::PartyTitle);
        let label = read_panel(&reader, &image, PanelRegion::GameNameLabel);
        assert!(
            language.is_word(&title, PARTY),
            "the title reads Party, got {title:?}"
        );
        assert!(
            language.is_word(&label, GAME_NAME),
            "the label reads Game Name, got {label:?}"
        );
        let field = read_panel(&reader, &image, PanelRegion::GameNameField);
        assert_eq!(
            read_field(&field, "DUEL NK LOCKS"),
            expected,
            "{name}: the field read {field:?}"
        );
    }

    #[test]
    fn ocr_reads_the_revealed_party_game_name() {
        assert_party_field("maintainer-party-revealed.png", FieldRead::Matched);
    }

    #[test]
    fn ocr_reads_the_revealed_party_game_name_with_the_tooltip_open() {
        assert_party_field("maintainer-party-revealed-tooltip.png", FieldRead::Matched);
    }

    #[test]
    fn ocr_reads_the_masked_party_game_name_as_masked() {
        assert_party_field("maintainer-party-masked.png", FieldRead::Masked);
    }

    /// Fails, rather than skips, when the en-US OCR engine is not installed on the machine.
    #[test]
    fn ocr_reads_the_reference_image() {
        let reader = WindowsOcr::new().expect(
            "the en-US Windows OCR engine is installed (this test fails, it never skips, without it)",
        );
        let read =
            read_game_name(&reference_image(), &reader).expect("the reference image is read");
        assert_eq!(read.text.trim().to_lowercase(), "mmbaalh-12");
    }
}
