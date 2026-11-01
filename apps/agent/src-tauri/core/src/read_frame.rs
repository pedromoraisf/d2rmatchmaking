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
