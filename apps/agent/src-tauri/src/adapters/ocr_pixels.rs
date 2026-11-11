//! The pixels Windows OCR reads (AGN-02): a region of an RGBA frame copied as BGRA and scaled up. The engine reads small
//! text poorly at the game's own size; the Party panel's text is about 12 px high, and a smooth enlargement gives its
//! glyphs the pixels the engine needs (T11). The copy is pure, so it is tested on every
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

/// The two source pixels one output pixel blends along one axis, and the weight of the second one out of `2 * scale`.
struct Tap {
    low: usize,
    high: usize,
    weight: u64,
}

/// The source pixels for output pixel `out` of a row of `len` source pixels enlarged `scale` times. Pixel centres are
/// aligned (output centre `out + 1/2` maps to source `(out + 1/2) / scale - 1/2`) and the ends are clamped to the region,
/// so nothing outside the region is read. Integer arithmetic only: the weight is out of `2 * scale`.
fn tap(out: usize, scale: usize, len: usize) -> Tap {
    let numerator = (2 * out + 1) as i64 - scale as i64;
    if numerator <= 0 {
        return Tap {
            low: 0,
            high: 0,
            weight: 0,
        };
    }
    let step = 2 * scale as i64;
    let low = (numerator / step) as usize;
    if low + 1 >= len {
        return Tap {
            low: len - 1,
            high: len - 1,
            weight: 0,
        };
    }
    Tap {
        low,
        high: low + 1,
        weight: (numerator % step) as u64,
    }
}

/// The BGRA rows of `region`, enlarged `scale` times in both directions with bilinear interpolation, every pixel opaque. `None` when
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
    let weight_one = 2 * scale as u64;
    let columns: Vec<Tap> = (0..out_width)
        .map(|x| tap(x, scale, region.width as usize))
        .collect();
    for out_y in 0..out_height {
        let vertical = tap(out_y, scale, region.height as usize);
        let row0 = (region.y as usize + vertical.low) * frame_row;
        let row1 = (region.y as usize + vertical.high) * frame_row;
        for horizontal in &columns {
            let x0 = (region.x as usize + horizontal.low) * 4;
            let x1 = (region.x as usize + horizontal.high) * 4;
            let mut bgr = [0u8; 3];
            // BGRA order from RGBA: channel 2 is blue, 1 green, 0 red.
            for (slot, channel) in bgr.iter_mut().zip([2usize, 1, 0]) {
                let at = |row: usize, x: usize| image.pixels[row + x + channel] as u64;
                let top = at(row0, x0) * (weight_one - horizontal.weight)
                    + at(row0, x1) * horizontal.weight;
                let bottom = at(row1, x0) * (weight_one - horizontal.weight)
                    + at(row1, x1) * horizontal.weight;
                let total = top * (weight_one - vertical.weight) + bottom * vertical.weight;
                let unit = weight_one * weight_one;
                *slot = ((total + unit / 2) / unit) as u8;
            }
            out.extend_from_slice(&[bgr[0], bgr[1], bgr[2], u8::MAX]);
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
    fn the_corners_keep_their_pixel_in_bgra_order_and_the_middle_blends() {
        let bgra = scaled_bgra(&frame(), whole(), 2).expect("the region is inside the frame");
        let at = |x: usize, y: usize| &bgra[(y * 4 + x) * 4..(y * 4 + x) * 4 + 4];
        // 4x4 output. The corners are the source pixels (clamped), as blue, green, red, opaque.
        assert_eq!(at(0, 0), &[0, 0, 255, 255], "red, as BGRA");
        assert_eq!(at(3, 0), &[0, 255, 0, 255], "green, as BGRA");
        assert_eq!(at(0, 3), &[255, 0, 0, 255], "blue, as BGRA");
        assert_eq!(at(3, 3), &[255, 255, 255, 255], "white");
        // Output (1, 0) lies a quarter of the way from red to green: 3/4 red, 1/4 green.
        assert_eq!(at(1, 0), &[0, 64, 191, 255], "between red and green");
        // Output (1, 1) is a quarter of the way both ways from red: 9/16 red, 3/16 green, 3/16 blue, 1/16 white.
        assert_eq!(at(1, 1), &[64, 64, 159, 255], "blended from all four");
    }

    #[test]
    fn a_flat_region_stays_flat_at_any_scale() {
        let flat = Rgba {
            width: 3,
            height: 2,
            pixels: [10, 20, 30, 255].repeat(6),
        };
        let region = Region {
            x: 0,
            y: 0,
            width: 3,
            height: 2,
        };
        let bgra = scaled_bgra(&flat, region, 3).expect("inside");
        assert_eq!(bgra.len(), 9 * 6 * 4);
        assert!(bgra.chunks(4).all(|p| p == [30, 20, 10, 255]));
    }

    #[test]
    fn a_blend_never_reads_outside_the_region() {
        // A 3x1 frame: the region is the middle pixel (green) between red and blue; its enlargement is all green.
        let frame = Rgba {
            width: 3,
            height: 1,
            pixels: vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
        };
        let region = Region {
            x: 1,
            y: 0,
            width: 1,
            height: 1,
        };
        let bgra = scaled_bgra(&frame, region, 3).expect("inside");
        assert!(bgra.chunks(4).all(|p| p == [0, 255, 0, 255]));
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
