//! Search, then track, the in-game HUD's label (the Life or Mana line). Searching reads the whole bottom band
//! (`ScreenRegion::HudBand`), which is the most OCR the marker costs; once a line is found, the next frames read only a
//! small box around it, and a miss goes back to searching the band. A pure state machine: it holds where the label was
//! and the client size that was measured on, and decides what to read next. No I/O, no clock, no randomness.

use crate::anchors::padded;
use crate::layout::{REFERENCE_HEIGHT, ScreenRegion, screen_region};
use crate::vision::Region;

/// How far around the remembered line the tracking box reaches, in pixels of the reference client: enough for the value
/// ("925 / 925") to grow or shrink and for the line to move a few pixels, small beside the band.
const TRACK_PAD: u32 = 24;

/// What to read on the next frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HudRead {
    /// The label is not known: read the whole band.
    Search(Region),
    /// The label was last seen here: read this box first, the band only on a miss.
    Track(Region),
}

/// Where the HUD's label was last seen, and in a client of what size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HudTracker {
    seen: Option<(Region, u32, u32)>,
}

impl HudTracker {
    /// The area to read on a frame of `width` × `height`. `None` when the size has no band. A label seen in a client of
    /// another size is forgotten: its box does not apply.
    pub fn next(&self, width: u32, height: u32) -> Option<HudRead> {
        let band = screen_region(ScreenRegion::HudBand, width, height)?;
        match self.seen {
            Some((line, seen_width, seen_height))
                if (seen_width, seen_height) == (width, height) =>
            {
                let pad = (u64::from(TRACK_PAD) * u64::from(height) / u64::from(REFERENCE_HEIGHT))
                    .max(1) as u32;
                Some(HudRead::Track(padded(line, pad, width, height)))
            }
            _ => Some(HudRead::Search(band)),
        }
    }

    /// Records what the frame showed: the label's line (to track it) or nothing (to search again).
    pub fn record(&mut self, found: Option<Region>, width: u32, height: u32) {
        self.seen = found.map(|line| (line, width, height));
    }
}

#[cfg(test)]
mod tests {
    use super::{HudRead, HudTracker};
    use crate::vision::Region;

    const LINE: Region = Region {
        x: 430,
        y: 860,
        width: 150,
        height: 20,
    };

    #[test]
    fn a_new_tracker_searches_the_whole_band() {
        let band = Region {
            x: 0,
            y: 810,
            width: 1920,
            height: 270,
        };
        assert_eq!(
            HudTracker::default().next(1920, 1080),
            Some(HudRead::Search(band))
        );
    }

    #[test]
    fn a_found_line_is_tracked_in_a_box_around_it() {
        let mut tracker = HudTracker::default();
        tracker.record(Some(LINE), 1920, 1080);
        // 24 px on the 1033 reference is 25 px at 1080.
        assert_eq!(
            tracker.next(1920, 1080),
            Some(HudRead::Track(Region {
                x: 405,
                y: 835,
                width: 200,
                height: 70
            }))
        );
    }

    #[test]
    fn a_miss_goes_back_to_searching() {
        let mut tracker = HudTracker::default();
        tracker.record(Some(LINE), 1920, 1080);
        tracker.record(None, 1920, 1080);
        assert!(matches!(tracker.next(1920, 1080), Some(HudRead::Search(_))));
    }

    #[test]
    fn a_line_seen_at_another_size_is_not_tracked() {
        let mut tracker = HudTracker::default();
        tracker.record(Some(LINE), 1920, 1080);
        assert!(matches!(tracker.next(1920, 1056), Some(HudRead::Search(_))));
        assert!(matches!(tracker.next(1921, 1080), Some(HudRead::Search(_))));
        assert!(matches!(tracker.next(1920, 1079), Some(HudRead::Search(_))));
    }

    #[test]
    fn the_box_stays_inside_the_client() {
        let mut tracker = HudTracker::default();
        let corner = Region {
            x: 0,
            y: 1070,
            width: 100,
            height: 10,
        };
        tracker.record(Some(corner), 1920, 1080);
        assert_eq!(
            tracker.next(1920, 1080),
            Some(HudRead::Track(Region {
                x: 0,
                y: 1045,
                width: 125,
                height: 35
            }))
        );
    }

    #[test]
    fn an_unsupported_size_reads_nothing() {
        assert_eq!(HudTracker::default().next(1280, 1024), None);
        assert_eq!(HudTracker::default().next(0, 0), None);
    }
}
