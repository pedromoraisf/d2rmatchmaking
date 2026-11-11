//! The pixels Windows OCR reads (AGN-02): a region of an RGBA frame copied as BGRA and scaled up. The engine reads small
//! text poorly at the game's own size; the Party panel's text is about 12 px high. The copy is pure, so it is tested on every
//! platform; only `windows_ocr.rs` hands the result to the engine.

use d2rmm_agent_core::ports::Rgba;
use d2rmm_agent_domain::vision::Region;

/// `region` grown by `pad_x` pixels left and right and `pad_y` pixels above and below, clamped to a frame of `width` × `height`.
/// The engine drops text that touches the edge of what it reads (T9: the character labels sit at their boxes' left edges and
/// read empty), so the crop keeps the frame's own background beside the text. Vertical padding is kept at 0 where rows sit
/// close together: a crop that reaches the next row reads its text too (T9, CI round 2). A region that is not inside the
/// frame is returned unchanged.
pub fn padded_region(region: Region, width: u32, height: u32, pad_x: u32, pad_y: u32) -> Region {
    let x0 = region.x.saturating_sub(pad_x);
    let y0 = region.y.saturating_sub(pad_y);
    let x1 = region
        .x
        .saturating_add(region.width)
        .saturating_add(pad_x)
        .min(width);
    let y1 = region
        .y
        .saturating_add(region.height)
        .saturating_add(pad_y)
        .min(height);
    if x1 <= x0 || y1 <= y0 || region.x >= width || region.y >= height {
        return region;
    }
    Region {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    }
}

/// The BGRA rows of `region`, each pixel repeated `scale` times in both directions, with every pixel opaque. `None` when
/// the scale or the region is empty, the region leaves the frame, or the frame's pixels do not hold exactly its size.
pub fn scaled_bgra(image: &Rgba, region: Region, scale: u32) -> Option<Vec<u8>> {
    if scale == 0 || region.width == 0 || region.height == 0 {
        return None;
    }
    if region.x.checked_add(region.width)? > image.width
        || region.y.checked_add(region.height)? > image.height
    {
        return None;
    }
    let frame_row = (image.width as usize).checked_mul(4)?;
    if image.pixels.len() != frame_row.checked_mul(image.height as usize)? {
        return None;
    }
    let scale = scale as usize;
    let out_width = (region.width as usize).checked_mul(scale)?;
    let out_height = (region.height as usize).checked_mul(scale)?;
    let mut out = Vec::with_capacity(out_width.checked_mul(out_height)?.checked_mul(4)?);
    for out_y in 0..out_height {
        let source_y = region.y as usize + out_y / scale;
        let row = &image.pixels[source_y * frame_row..(source_y + 1) * frame_row];
        for out_x in 0..out_width {
            let source_x = region.x as usize + out_x / scale;
            let pixel = &row[source_x * 4..source_x * 4 + 4];
            out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], u8::MAX]);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::ports::Rgba;
    use d2rmm_agent_domain::vision::Region;

    use super::scaled_bgra;

    /// A 2×2 frame: red, green on the top row; blue, white on the bottom row (RGBA).
    fn frame() -> Rgba {
        Rgba {
            width: 2,
            height: 2,
            pixels: vec![
                255, 0, 0, 255, 0, 255, 0, 255, //
                0, 0, 255, 255, 255, 255, 255, 255,
            ],
        }
    }

    fn whole() -> Region {
        Region {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        }
    }

    #[test]
    fn the_output_holds_the_region_at_the_scale() {
        let bgra = scaled_bgra(&frame(), whole(), 3).expect("the region is inside the frame");
        assert_eq!(bgra.len(), 6 * 6 * 4, "two pixels become six, both ways");
    }

    #[test]
    fn each_pixel_repeats_in_bgra_order() {
        let bgra = scaled_bgra(&frame(), whole(), 2).expect("the region is inside the frame");
        // The first output row: red twice, then green twice, each as blue, green, red, opaque.
        assert_eq!(&bgra[0..4], &[0, 0, 255, 255], "red, as BGRA");
        assert_eq!(&bgra[4..8], &[0, 0, 255, 255], "the same pixel again");
        assert_eq!(&bgra[8..12], &[0, 255, 0, 255], "green, as BGRA");
        // The third output row is the second source row: blue, then white.
        let third_row = 4 * 4 * 2;
        assert_eq!(
            &bgra[third_row..third_row + 4],
            &[255, 0, 0, 255],
            "blue, as BGRA"
        );
    }

    #[test]
    fn a_sub_region_starts_at_its_origin() {
        let region = Region {
            x: 1,
            y: 1,
            width: 1,
            height: 1,
        };
        assert_eq!(
            scaled_bgra(&frame(), region, 1),
            Some(vec![255, 255, 255, 255]),
            "the bottom-right pixel"
        );
    }

    #[test]
    fn a_region_outside_the_frame_or_an_empty_scale_is_refused() {
        let outside = Region {
            x: 1,
            y: 1,
            width: 2,
            height: 1,
        };
        assert_eq!(
            scaled_bgra(&frame(), outside, 1),
            None,
            "one column too far"
        );
        assert_eq!(scaled_bgra(&frame(), whole(), 0), None, "no scale");
        let empty = Region {
            x: 0,
            y: 0,
            width: 0,
            height: 1,
        };
        assert_eq!(scaled_bgra(&frame(), empty, 1), None, "no width");
    }

    #[test]
    fn the_crop_grows_by_the_padding_and_clamps_at_the_frame_edges() {
        use super::padded_region;
        let inside = Region {
            x: 10,
            y: 20,
            width: 30,
            height: 40,
        };
        assert_eq!(
            padded_region(inside, 1920, 1080, 16, 4),
            Region {
                x: 0,
                y: 16,
                width: 56,
                height: 48,
            },
            "16 px left and right, the left one clamped to the frame edge at 0; 4 px above and below"
        );
        assert_eq!(
            padded_region(inside, 1920, 1080, 0, 0),
            inside,
            "no padding"
        );
        let corner = Region {
            x: 1900,
            y: 1060,
            width: 20,
            height: 20,
        };
        assert_eq!(
            padded_region(corner, 1920, 1080, 16, 16),
            Region {
                x: 1884,
                y: 1044,
                width: 36,
                height: 36,
            },
            "the right and bottom edges clamp to the frame"
        );
    }

    #[test]
    fn a_region_outside_the_frame_is_returned_unchanged_for_the_scaler_to_refuse() {
        use super::padded_region;
        let outside = Region {
            x: 2000,
            y: 0,
            width: 10,
            height: 10,
        };
        assert_eq!(padded_region(outside, 1920, 1080, 16, 16), outside);
    }

    #[test]
    fn pixels_that_do_not_hold_the_frame_are_refused() {
        let short = Rgba {
            width: 2,
            height: 2,
            pixels: vec![0; 15],
        };
        assert_eq!(scaled_bgra(&short, whole(), 1), None);
    }
}
