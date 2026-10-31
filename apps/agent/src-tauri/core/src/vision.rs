//! The vision step: reads the game name from the built-in region of a frame (design.md § Vision and fusion; AGS-16).
//! The text reader runs on this machine; the frame and the crop never leave the process (AGS-20).

use crate::ports::{ReadError, ReadText, Region, Rgba, TextReader};

/// The automap's game-name block in a 1920×1080 frame (AD-047). The F0 fixture is drawn inside it.
pub const AUTOMAP_NAME_1080P: Region = Region {
    x: 1380,
    y: 40,
    width: 520,
    height: 80,
};

/// The built-in region for a frame of this size, when one is built in.
pub fn region_for(width: u32, height: u32) -> Option<Region> {
    match (width, height) {
        (1920, 1080) => Some(AUTOMAP_NAME_1080P),
        _ => None,
    }
}

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
