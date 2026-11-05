//! Reads one frame (design.md § Vision and fusion; AGS-16). The built-in region comes from the domain (AD-047); the text
//! reader runs on this machine through its port. The frame and the crop never leave the process (AGS-20).

use d2rmm_agent_domain::vision::{ReadText, region_for};

use crate::ports::{ReadError, Rgba, TextReader};

/// Reads the first line of the game-name region of `image`. A frame size without a built-in region reads nothing.
pub fn read_game_name(image: &Rgba, reader: &dyn TextReader) -> Result<ReadText, ReadError> {
    let _span = tracing::info_span!("agent.vision.read").entered();
    let region = region_for(image.width, image.height).ok_or(ReadError::Failed)?;
    let read = reader.read(image, region)?;
    let first_line = read.text.lines().next().unwrap_or_default().to_string();
    Ok(ReadText {
        text: first_line,
        confidence: read.confidence,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use d2rmm_agent_domain::vision::{AUTOMAP_NAME_1080P, ReadText, Region};

    use super::read_game_name;
    use crate::ports::{ReadError, Rgba, TextReader};

    /// Returns the same text for any region and remembers the regions it was asked to read.
    struct FixedReader {
        text: String,
        regions: Mutex<Vec<Region>>,
    }

    impl FixedReader {
        fn reading(text: &str) -> Self {
            Self {
                text: text.to_string(),
                regions: Mutex::new(Vec::new()),
            }
        }
    }

    impl TextReader for FixedReader {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.regions.lock().expect("the regions lock").push(region);
            Ok(ReadText {
                text: self.text.clone(),
                confidence: 0.93,
            })
        }
    }

    #[test]
    fn reads_first_line_of_region() {
        let reader = FixedReader::reading("mmbaalh-12\nDifficulty: Hell");
        let frame = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };

        let read = read_game_name(&frame, &reader).expect("the built-in region reads");

        assert_eq!(read.text, "mmbaalh-12");
        assert_eq!(
            *reader.regions.lock().expect("the regions lock"),
            vec![AUTOMAP_NAME_1080P]
        );
    }

    #[test]
    fn unsupported_resolution_reads_nothing() {
        let reader = FixedReader::reading("mmbaalh-12");
        let frame = Rgba {
            width: 1280,
            height: 720,
            pixels: Vec::new(),
        };

        assert_eq!(read_game_name(&frame, &reader), Err(ReadError::Failed));
        assert!(reader.regions.lock().expect("the regions lock").is_empty());
    }
}
