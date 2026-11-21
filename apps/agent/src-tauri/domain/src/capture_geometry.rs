//! The client-area geometry of a captured frame (capture-cascade CAP-04, CAP-06; ADR 010). Some methods capture the whole
//! window, title bar and borders included; the agent keeps the client area only, and refuses a frame that cannot hold it,
//! so the reading's regions (fractions of the client) mean the same thing whichever method produced the frame.

/// The rectangle of a frame that is the game's client area, in frame pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The rectangle to keep of a frame of `frame` size (width, height) when the client area of `client` size sits at
/// `offset` (x, y) inside it. `None` when the client has no area, or the frame cannot hold it at that offset (a size that
/// does not match, an overflow).
pub fn crop_to_client(
    frame: (u32, u32),
    offset: (u32, u32),
    client: (u32, u32),
) -> Option<ClientRect> {
    let (frame_width, frame_height) = frame;
    let (x, y) = offset;
    let (width, height) = client;
    if width == 0 || height == 0 {
        return None;
    }
    if x.checked_add(width)? > frame_width || y.checked_add(height)? > frame_height {
        return None;
    }
    Some(ClientRect {
        x,
        y,
        width,
        height,
    })
}

/// The RGBA bytes of `rect` out of a frame `frame_width` pixels wide, row by row. `None` when the rectangle does not lie in
/// the pixels (a size that overflows, or too few bytes).
pub fn crop_rgba(pixels: &[u8], frame_width: u32, rect: ClientRect) -> Option<Vec<u8>> {
    let row_bytes = usize::try_from(rect.width).ok()?.checked_mul(4)?;
    let stride = usize::try_from(frame_width).ok()?.checked_mul(4)?;
    let height = usize::try_from(rect.height).ok()?;
    let total = row_bytes.checked_mul(height)?;
    if total > pixels.len() {
        return None;
    }
    let mut cropped = Vec::with_capacity(total);
    for row in 0..height {
        let top = usize::try_from(rect.y).ok()?.checked_add(row)?;
        let start = top
            .checked_mul(stride)?
            .checked_add(usize::try_from(rect.x).ok()?.checked_mul(4)?)?;
        cropped.extend_from_slice(pixels.get(start..start.checked_add(row_bytes)?)?);
    }
    Some(cropped)
}

#[cfg(test)]
mod tests {
    use super::{ClientRect, crop_rgba, crop_to_client};

    #[test]
    fn a_windowed_frame_keeps_the_client_area_below_the_title_bar() {
        // The whole window: 8 px borders and a 31 px title bar around a 1920×1080 client (as `window_capture` tests use).
        assert_eq!(
            crop_to_client((1936, 1119), (8, 31), (1920, 1080)),
            Some(ClientRect {
                x: 8,
                y: 31,
                width: 1920,
                height: 1080
            })
        );
    }

    #[test]
    fn a_borderless_frame_is_the_client_area_itself() {
        assert_eq!(
            crop_to_client((1920, 1080), (0, 0), (1920, 1080)),
            Some(ClientRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080
            })
        );
    }

    #[test]
    fn a_frame_that_cannot_hold_the_client_is_refused() {
        assert_eq!(crop_to_client((1919, 1080), (0, 0), (1920, 1080)), None);
        assert_eq!(crop_to_client((1920, 1079), (0, 0), (1920, 1080)), None);
        // The client fits by size but not at its offset.
        assert_eq!(crop_to_client((1920, 1080), (1, 0), (1920, 1080)), None);
        assert_eq!(crop_to_client((1920, 1080), (0, 1), (1920, 1080)), None);
    }

    #[test]
    fn a_client_without_area_is_refused() {
        assert_eq!(crop_to_client((1920, 1080), (0, 0), (0, 1080)), None);
        assert_eq!(crop_to_client((1920, 1080), (0, 0), (1920, 0)), None);
    }

    #[test]
    fn an_offset_that_overflows_is_refused_not_wrapped() {
        assert_eq!(
            crop_to_client((u32::MAX, u32::MAX), (u32::MAX, 0), (2, 2)),
            None
        );
        assert_eq!(
            crop_to_client((u32::MAX, u32::MAX), (0, u32::MAX), (2, 2)),
            None
        );
    }

    /// A 4×3 frame whose pixel (x, y) is `[x, y, 0, 255]`.
    fn grid() -> Vec<u8> {
        let mut pixels = Vec::new();
        for y in 0..3_u8 {
            for x in 0..4_u8 {
                pixels.extend_from_slice(&[x, y, 0, 255]);
            }
        }
        pixels
    }

    #[test]
    fn the_crop_copies_the_rectangle_row_by_row() {
        let rect = ClientRect {
            x: 1,
            y: 1,
            width: 2,
            height: 2,
        };
        assert_eq!(
            crop_rgba(&grid(), 4, rect),
            Some(vec![1, 1, 0, 255, 2, 1, 0, 255, 1, 2, 0, 255, 2, 2, 0, 255])
        );
    }

    #[test]
    fn the_whole_frame_crops_to_itself() {
        let rect = ClientRect {
            x: 0,
            y: 0,
            width: 4,
            height: 3,
        };
        assert_eq!(crop_rgba(&grid(), 4, rect), Some(grid()));
    }

    #[test]
    fn a_rectangle_outside_the_pixels_is_refused() {
        let outside = ClientRect {
            x: 3,
            y: 0,
            width: 2,
            height: 1,
        };
        // Row 0 holds 16 bytes, but the rectangle ends at pixel 5 of a 4-wide row: the first row reads into row 1.
        assert!(crop_rgba(&grid()[..16], 4, outside).is_none());
        let below = ClientRect {
            x: 0,
            y: 3,
            width: 1,
            height: 1,
        };
        assert_eq!(crop_rgba(&grid(), 4, below), None);
    }

    #[test]
    fn a_size_that_overflows_is_refused_not_allocated() {
        let huge = ClientRect {
            x: 0,
            y: 0,
            width: u32::MAX,
            height: u32::MAX,
        };
        assert_eq!(crop_rgba(&[], u32::MAX, huge), None);
        let big = ClientRect {
            x: 0,
            y: 0,
            width: 100_000,
            height: 100_000,
        };
        assert_eq!(
            crop_rgba(&grid(), 100_000, big),
            None,
            "no allocation past the pixels"
        );
    }
}
