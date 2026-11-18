//! Is there text where a card's title would be drawn? When no OCR variant read a line above a card's name, the card may be
//! untitled or its title may be unread (a Matriarch read as a plain Sorceress would land on the wrong ladder). This is the
//! pixel test of that band: it counts the text-like pixels of the band and of the name line itself and compares them. Pure
//! over `Rgba` and `Region`; the frame never leaves the process (AGS-20).
//!
//! A pixel is text-like when its luma is `INK_LUMA_ABOVE_MEDIAN` or more above the median luma of its own region (so an
//! empty band of any background is quiet), or when it is saturated gold or red (the colours of the titles and of the
//! hardcore ones). A row where more than `BORDER_ROW_PERCENT` of the pixels are text-like is a frame border or a rule, not
//! lettering (a line of text never fills the row of a band twice as wide as the name), and is not counted. The band has ink
//! when it holds at least `MIN_INK_PIXELS` text-like pixels and at least a quarter (`INK_RATIO`) of the name line's own.

use d2rmm_agent_domain::character_screen::{is_gold, luma};
use d2rmm_agent_domain::vision::Region;

use crate::ports::Rgba;

/// How far above the median luma of its region a pixel must be to count as text.
pub const INK_LUMA_ABOVE_MEDIAN: u8 = 60;

/// A row with more than this percent of text-like pixels is a border, not text.
pub const BORDER_ROW_PERCENT: usize = 60;

/// The fewest text-like pixels a band holds to have ink: one small letter is about 20 of them at 1080 (an empty dark band
/// holds none).
pub const MIN_INK_PIXELS: usize = 12;

/// The band has ink when its count times this reaches the name line's count: a title is drawn as large as a name.
pub const INK_RATIO: usize = 4;

/// The red, green and blue of the pixel at `x`, `y`, or `None` outside the frame.
fn pixel(frame: &Rgba, x: u32, y: u32) -> Option<[u8; 3]> {
    if x >= frame.width || y >= frame.height {
        return None;
    }
    let at = (y as usize * frame.width as usize + x as usize) * 4;
    match frame.pixels.get(at..at + 3) {
        Some(&[red, green, blue]) => Some([red, green, blue]),
        _ => None,
    }
}

/// Saturated red, as the titles of hardcore characters are drawn.
fn is_red(red: u8, green: u8, blue: u8) -> bool {
    red >= 120 && u16::from(red) >= 2 * u16::from(green) && u16::from(red) >= 2 * u16::from(blue)
}

/// The text-like pixels of a region, not counting the rows of a border. A region outside the frame has none.
pub fn ink_pixels(frame: &Rgba, area: Region) -> usize {
    let rows: Vec<Vec<[u8; 3]>> = (area.y..area.bottom())
        .map(|y| {
            (area.x..area.right())
                .filter_map(|x| pixel(frame, x, y))
                .collect()
        })
        .collect();
    let mut lumas: Vec<u8> = rows
        .iter()
        .flatten()
        .map(|&[red, green, blue]| luma(red, green, blue))
        .collect();
    if lumas.is_empty() {
        return 0;
    }
    lumas.sort_unstable();
    let median = lumas[lumas.len() / 2];
    let threshold = median.saturating_add(INK_LUMA_ABOVE_MEDIAN);
    let text_like = |&[red, green, blue]: &[u8; 3]| {
        (luma(red, green, blue) >= threshold && threshold > median)
            || is_gold(red, green, blue)
            || is_red(red, green, blue)
    };
    rows.iter()
        .map(|row| row.iter().filter(|px| text_like(px)).count())
        .filter(|count| count * 100 <= area.width as usize * BORDER_ROW_PERCENT)
        .sum()
}

/// Whether the band where a title would be drawn holds text: its text-like pixels against those of the name line.
pub fn band_has_ink(frame: &Rgba, band: Region, name: Region) -> bool {
    let in_band = ink_pixels(frame, band);
    in_band >= MIN_INK_PIXELS && in_band * INK_RATIO >= ink_pixels(frame, name)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::vision::Region;

    use super::{band_has_ink, ink_pixels};
    use crate::ports::Rgba;

    const WIDTH: u32 = 200;
    const HEIGHT: u32 = 120;

    fn frame(background: [u8; 3]) -> Rgba {
        let mut pixels = Vec::new();
        for _ in 0..WIDTH * HEIGHT {
            pixels.extend_from_slice(&[background[0], background[1], background[2], 255]);
        }
        Rgba {
            width: WIDTH,
            height: HEIGHT,
            pixels,
        }
    }

    fn paint(frame: &mut Rgba, area: Region, colour: [u8; 3]) {
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                let at = ((y * frame.width + x) * 4) as usize;
                frame.pixels[at..at + 3].copy_from_slice(&colour);
            }
        }
    }

    fn region(x: u32, y: u32, width: u32, height: u32) -> Region {
        Region {
            x,
            y,
            width,
            height,
        }
    }

    /// A line of lettering: vertical strokes 2 px wide every 6 px, the way text fills a box about a third of its width.
    fn write(frame: &mut Rgba, area: Region, colour: [u8; 3]) {
        let mut x = area.x + 1;
        while x + 2 <= area.right() {
            paint(frame, region(x, area.y + 2, 2, area.height - 4), colour);
            x += 6;
        }
    }

    const NAME: Region = Region {
        x: 20,
        y: 80,
        width: 60,
        height: 16,
    };
    const BAND: Region = Region {
        x: 20,
        y: 50,
        width: 120,
        height: 16,
    };

    #[test]
    fn an_empty_dark_band_has_no_ink() {
        let mut image = frame([20, 20, 22]);
        write(&mut image, NAME, [220, 220, 220]);
        assert!(ink_pixels(&image, NAME) > 100);
        assert_eq!(ink_pixels(&image, BAND), 0);
        assert!(!band_has_ink(&image, BAND, NAME));
    }

    #[test]
    fn a_band_with_lettering_of_the_name_s_size_has_ink() {
        let mut image = frame([20, 20, 22]);
        write(&mut image, NAME, [220, 220, 220]);
        write(&mut image, region(20, 50, 54, 16), [220, 220, 220]);
        assert!(band_has_ink(&image, BAND, NAME));
    }

    #[test]
    fn gold_and_red_lettering_count_even_on_a_bright_background() {
        // On a background this bright nothing is 60 above the median, but a gold or red stroke is still ink.
        for colour in [[200, 170, 80], [200, 40, 30]] {
            let mut image = frame([150, 150, 150]);
            write(&mut image, NAME, [255, 255, 255]);
            write(&mut image, region(20, 50, 54, 16), colour);
            assert!(band_has_ink(&image, BAND, NAME), "{colour:?}");
        }
    }

    #[test]
    fn a_few_stray_pixels_are_not_ink_and_neither_is_a_faint_smudge() {
        let mut image = frame([20, 20, 22]);
        write(&mut image, NAME, [220, 220, 220]);
        paint(&mut image, region(30, 55, 2, 3), [220, 220, 220]);
        assert!(!band_has_ink(&image, BAND, NAME), "6 pixels");
        // 30 above the median is below the 60 the lettering must stand out by.
        let mut smudge = frame([20, 20, 22]);
        write(&mut smudge, NAME, [220, 220, 220]);
        write(&mut smudge, region(20, 50, 54, 16), [50, 50, 52]);
        assert!(!band_has_ink(&smudge, BAND, NAME));
    }

    #[test]
    fn a_border_across_the_band_is_not_lettering() {
        let mut image = frame([20, 20, 22]);
        write(&mut image, NAME, [220, 220, 220]);
        // The gold top border of a selected card: full rows, wider than the band.
        paint(&mut image, region(0, 56, WIDTH, 2), [227, 201, 97]);
        assert_eq!(ink_pixels(&image, BAND), 0);
        assert!(!band_has_ink(&image, BAND, NAME));
    }

    #[test]
    fn a_title_is_ink_against_a_name_ten_times_as_large_only_up_to_the_ratio() {
        // The band's count must reach a quarter of the name line's: one stroke against a full line does not.
        let mut image = frame([20, 20, 22]);
        write(&mut image, NAME, [220, 220, 220]);
        paint(&mut image, region(20, 52, 2, 12), [220, 220, 220]);
        let (name, band) = (ink_pixels(&image, NAME), ink_pixels(&image, BAND));
        assert_eq!(band, 24);
        assert!(band * 4 < name, "{band} against {name}");
        assert!(!band_has_ink(&image, BAND, NAME));
    }

    #[test]
    fn a_region_outside_the_frame_has_no_ink() {
        let image = frame([20, 20, 22]);
        assert_eq!(ink_pixels(&image, region(WIDTH + 5, 10, 40, 16)), 0);
        assert!(!band_has_ink(
            &image,
            region(WIDTH + 5, 10, 40, 16),
            region(WIDTH + 5, 40, 40, 16)
        ));
    }
}
