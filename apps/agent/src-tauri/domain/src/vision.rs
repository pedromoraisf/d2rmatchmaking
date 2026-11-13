//! The vision rule: where the game name sits in a frame (AD-047) and the text read from it. The reader itself is a port in
//! core; the frame and the crop never leave the process (AGS-20).

/// A rectangle of an image, in pixels, with its origin at the top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    /// The row of pixels through the middle of the region.
    pub fn middle_y(self) -> u32 {
        self.y + self.height / 2
    }

    /// The column of pixels through the middle of the region.
    pub fn middle_x(self) -> u32 {
        self.x + self.width / 2
    }

    /// One past the last column of the region.
    pub fn right(self) -> u32 {
        self.x + self.width
    }

    /// One past the last row of the region.
    pub fn bottom(self) -> u32 {
        self.y + self.height
    }
}

/// One line of text the reader found in a region, with where the line sits in the frame (coordinates of the frame, not of
/// the region that was read). The screen readers anchor on the lines' content instead of on fixed offsets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextLine {
    pub text: String,
    pub region: Region,
}

/// Text read from a region, with the reader's confidence.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadText {
    pub text: String,
    pub confidence: f64,
}

/// The automap's game-name block in a 1920×1080 frame (AD-047). The F0 fixture is drawn inside it.
pub const AUTOMAP_NAME_1080P: Region = Region {
    x: 1380,
    y: 40,
    width: 520,
    height: 80,
};

/// The built-in region for a frame of this size, when one is built in. Only 1920×1080 has one; any other size, even a
/// size next to it, has none.
pub fn region_for(width: u32, height: u32) -> Option<Region> {
    match (width, height) {
        (1920, 1080) => Some(AUTOMAP_NAME_1080P),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{AUTOMAP_NAME_1080P, region_for};

    #[test]
    fn region_for_is_the_automap_block_at_1080p() {
        assert_eq!(region_for(1920, 1080), Some(AUTOMAP_NAME_1080P));
    }

    #[test]
    fn region_for_is_none_on_each_side_of_the_size_boundary() {
        assert_eq!(region_for(1919, 1080), None, "one pixel narrower");
        assert_eq!(region_for(1921, 1080), None, "one pixel wider");
        assert_eq!(region_for(1920, 1079), None, "one pixel shorter");
        assert_eq!(region_for(1920, 1081), None, "one pixel taller");
        assert_eq!(region_for(1280, 720), None, "a smaller resolution");
        assert_eq!(region_for(0, 0), None, "an empty frame");
    }

    #[test]
    fn automap_block_is_pinned() {
        assert_eq!(AUTOMAP_NAME_1080P.x, 1380);
        assert_eq!(AUTOMAP_NAME_1080P.y, 40);
        assert_eq!(AUTOMAP_NAME_1080P.width, 520);
        assert_eq!(AUTOMAP_NAME_1080P.height, 80);
    }
}
