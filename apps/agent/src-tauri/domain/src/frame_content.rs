//! A cheap summary of what a captured frame holds, to tell a blank or stale capture from a real one (the Windows incident
//! of 2026-11-19: the game was on screen and the agent read "not recognised"). Only two numbers come out of a frame; the
//! frame itself is never kept or sent (NFR-04).

/// One pixel in this many is looked at: a 1080p frame has about two million pixels, and the summary needs a few thousand.
const SAMPLE_EVERY: usize = 31;

/// A frame whose brightest and darkest sampled pixels differ by no more than this is uniform: nothing was drawn on it.
const UNIFORM_SPREAD: u8 = 4;

/// A frame whose brightest sampled pixel is no brighter than this is black.
const NEAR_BLACK: u8 = 8;

/// What the sampled pixels of a frame show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameContent {
    /// The mean luminance of the sampled pixels, 0 (black) to 255 (white).
    pub brightness: u8,
    /// The frame is uniform or near-black: a blank capture, not a drawn game.
    pub blank: bool,
}

/// The luminance of one RGBA pixel (Rec. 709 weights, integer arithmetic, alpha ignored).
fn luminance(pixel: &[u8; 4]) -> u8 {
    let weighted =
        2126 * u32::from(pixel[0]) + 7152 * u32::from(pixel[1]) + 722 * u32::from(pixel[2]);
    u8::try_from(weighted / 10_000).unwrap_or(u8::MAX)
}

/// The summary of an RGBA frame. An empty frame is blank.
pub fn summarize(rgba: &[u8]) -> FrameContent {
    let (pixels, _remainder) = rgba.as_chunks::<4>();
    let mut count = 0_u64;
    let mut sum = 0_u64;
    let mut darkest = u8::MAX;
    let mut brightest = u8::MIN;
    for pixel in pixels.iter().step_by(SAMPLE_EVERY) {
        let value = luminance(pixel);
        count += 1;
        sum += u64::from(value);
        darkest = darkest.min(value);
        brightest = brightest.max(value);
    }
    if count == 0 {
        return FrameContent {
            brightness: 0,
            blank: true,
        };
    }
    FrameContent {
        brightness: u8::try_from(sum / count).unwrap_or(u8::MAX),
        blank: brightest - darkest <= UNIFORM_SPREAD || brightest <= NEAR_BLACK,
    }
}

#[cfg(test)]
mod tests {
    use super::{FrameContent, NEAR_BLACK, SAMPLE_EVERY, UNIFORM_SPREAD, summarize};

    /// A frame of `count` grey pixels, each one `grey`, except the pixel at `index`, which is `other`.
    fn frame(count: usize, grey: u8, index: usize, other: u8) -> Vec<u8> {
        let mut rgba = Vec::new();
        for at in 0..count {
            let value = if at == index { other } else { grey };
            rgba.extend_from_slice(&[value, value, value, 255]);
        }
        rgba
    }

    #[test]
    fn an_empty_frame_is_blank() {
        assert_eq!(
            summarize(&[]),
            FrameContent {
                brightness: 0,
                blank: true
            }
        );
    }

    #[test]
    fn a_black_frame_is_blank_with_no_brightness() {
        assert_eq!(
            summarize(&frame(100, 0, 0, 0)),
            FrameContent {
                brightness: 0,
                blank: true
            }
        );
    }

    #[test]
    fn a_uniform_bright_frame_is_blank_but_reports_its_brightness() {
        assert_eq!(
            summarize(&frame(100, 200, 0, 200)),
            FrameContent {
                brightness: 200,
                blank: true
            }
        );
    }

    #[test]
    fn a_spread_of_four_is_still_uniform_and_five_is_drawn() {
        // Pixel 0 is sampled; a bright frame keeps `near black` out of the way.
        let at_limit = summarize(&frame(100, 100, 0, 100 + UNIFORM_SPREAD));
        let beyond = summarize(&frame(100, 100, 0, 100 + UNIFORM_SPREAD + 1));
        assert!(at_limit.blank);
        assert!(!beyond.blank);
    }

    #[test]
    fn a_dark_but_drawn_frame_is_not_blank() {
        // A low-brightness HUD: mean 30, spread 40 (pixel 0 is sampled). It is drawn, not a blank capture (CAP-06).
        let dark = summarize(&frame(100, 20, 0, 60));
        assert_eq!(dark.brightness, 30);
        assert!(!dark.blank);
        // The same grey with nothing drawn on it is uniform, and is blank.
        assert!(summarize(&frame(100, 20, 0, 20)).blank);
    }

    #[test]
    fn a_brightest_pixel_of_eight_is_near_black_and_nine_is_not() {
        let at_limit = summarize(&frame(100, 0, 0, NEAR_BLACK));
        let beyond = summarize(&frame(100, 0, 0, NEAR_BLACK + 1));
        assert!(at_limit.blank);
        // A spread of nine is drawn, and nine is not near black.
        assert!(!beyond.blank);
    }

    #[test]
    fn the_brightness_is_the_mean_of_the_sampled_pixels() {
        // Two sampled pixels, 0 and 100 (the second is the 32nd pixel).
        let rgba = frame(SAMPLE_EVERY + 1, 0, SAMPLE_EVERY, 100);
        assert_eq!(
            summarize(&rgba),
            FrameContent {
                brightness: 50,
                blank: false
            }
        );
    }

    #[test]
    fn a_pixel_between_two_samples_is_not_looked_at() {
        let rgba = frame(SAMPLE_EVERY, 0, 1, 255);
        assert!(summarize(&rgba).blank);
    }

    #[test]
    fn the_luminance_favours_green_then_red_then_blue() {
        let red = summarize(&[255, 0, 0, 255]).brightness;
        let green = summarize(&[0, 255, 0, 255]).brightness;
        let blue = summarize(&[0, 0, 255, 255]).brightness;
        assert_eq!((red, green, blue), (54, 182, 18));
    }

    #[test]
    fn white_is_the_brightest() {
        assert_eq!(summarize(&[255, 255, 255, 255]).brightness, 255);
    }
}
