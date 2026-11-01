//! The Windows OCR reader (design.md § Vision and fusion; AGS-16, AGS-20). The engine is fixed to en-US. The crop is
//! copied into an in-process bitmap and read there, so no image and no text leaves the process. The WinRT calls are
//! safe wrappers; this file is one of the two that may allow unsafe code (ADR 010 policy).
#![allow(unsafe_code)]

use d2rmm_agent_core::ports::{ReadError, ReadText, Region, Rgba, TextReader};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

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

/// Copies the region into a BGRA8 software bitmap. The source is RGBA8 with rows of `image.width` pixels.
fn crop_to_bitmap(image: &Rgba, region: Region) -> Result<SoftwareBitmap, ReadError> {
    let width = region.width as usize;
    let height = region.height as usize;
    let row_bytes = image.width as usize * 4;
    let mut bgra = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        let start = (region.y as usize + row) * row_bytes + region.x as usize * 4;
        let source = image
            .pixels
            .get(start..start + width * 4)
            .ok_or(ReadError::Failed)?;
        for pixel in source.as_chunks::<4>().0 {
            bgra.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
        }
    }
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
    use d2rmm_agent_core::ports::Rgba;
    use d2rmm_agent_core::vision::read_game_name;

    use super::WindowsOcr;

    /// The committed F0 reference image (AD-047), decoded to RGBA8.
    fn reference_image() -> Rgba {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/automap-game-name.png"
        );
        let bytes = std::fs::read(path).expect("the reference image is committed");
        let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .expect("the reference image is a PNG");
        let mut pixels = vec![0; decoder.output_buffer_size().expect("the image size fits")];
        let info = decoder
            .next_frame(&mut pixels)
            .expect("the reference image decodes");
        Rgba {
            width: info.width,
            height: info.height,
            pixels,
        }
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
