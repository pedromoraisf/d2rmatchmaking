//! Search, then track, a label of the in-game screens: the HUD's Life or Mana line (`ScreenRegion::HudBand`) and the
//! automap's "Difficulty:" line (`ScreenRegion::AutomapArea`). Searching reads the whole wide area, which is the most OCR
//! the marker costs; once a line is found, the next frames read only a small box around it, and a miss goes back to
//! searching the area. A pure state machine: it holds where the label was and the client size that was measured on, and
//! decides what to read next. No I/O, no clock, no randomness.

use crate::anchors::padded;
use crate::layout::{REFERENCE_HEIGHT, ScreenRegion, screen_region};
use crate::vision::Region;

/// How far around the remembered line the tracking box reaches, in pixels of the reference client: enough for the value
/// ("925 / 925") to grow or shrink and for the line to move a few pixels, small beside the band.
const TRACK_PAD: u32 = 24;

/// What to read on the next frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackRead {
    /// The label is not known: read the whole search area.
    Search(Region),
    /// The label was last seen here: read this box first, the search area only on a miss.
    Track(Region),
}

/// Where a label was last seen, and in a client of what size, with the area it is searched in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tracker {
    search: ScreenRegion,
    seen: Option<(Region, u32, u32)>,
}

impl Tracker {
    /// A tracker that has seen nothing, searching `search` (a wide area such as `ScreenRegion::HudBand`).
    pub fn new(search: ScreenRegion) -> Self {
        Self { search, seen: None }
    }

    /// The area to read on a frame of `width` × `height`. `None` when the size has no area. A label seen in a client of
    /// another size is forgotten: its box does not apply.
    pub fn next(&self, width: u32, height: u32) -> Option<TrackRead> {
        let area = screen_region(self.search, width, height)?;
        match self.seen {
            Some((line, seen_width, seen_height))
                if (seen_width, seen_height) == (width, height) =>
            {
                let pad = (u64::from(TRACK_PAD) * u64::from(height) / u64::from(REFERENCE_HEIGHT))
                    .max(1) as u32;
                Some(TrackRead::Track(padded(line, pad, width, height)))
            }
            _ => Some(TrackRead::Search(area)),
        }
    }

    /// The area this tracker searches when its box misses.
    pub fn search_area(&self, width: u32, height: u32) -> Option<Region> {
        screen_region(self.search, width, height)
    }

    /// Records what the frame showed: the label's line (to track it) or nothing (to search again).
    pub fn record(&mut self, found: Option<Region>, width: u32, height: u32) {
        self.seen = found.map(|line| (line, width, height));
    }
}

#[cfg(test)]
mod tests {
    use super::{TrackRead, Tracker};
    use crate::layout::ScreenRegion;
    use crate::vision::Region;

    const LINE: Region = Region {
        x: 430,
        y: 860,
        width: 150,
        height: 20,
    };

    fn hud() -> Tracker {
        Tracker::new(ScreenRegion::HudBand)
    }

    #[test]
    fn a_new_tracker_searches_the_whole_band() {
        let band = Region {
            x: 0,
            y: 810,
            width: 1920,
            height: 270,
        };
        assert_eq!(hud().next(1920, 1080), Some(TrackRead::Search(band)));
        assert_eq!(hud().search_area(1920, 1080), Some(band));
    }

    #[test]
    fn a_tracker_searches_the_area_it_was_made_for() {
        let automap = Tracker::new(ScreenRegion::AutomapArea);
        assert_eq!(
            automap.next(1920, 1080),
            Some(TrackRead::Search(
                crate::layout::screen_region(ScreenRegion::AutomapArea, 1920, 1080).expect("area")
            ))
        );
    }

    #[test]
    fn a_found_line_is_tracked_in_a_box_around_it() {
        let mut tracker = hud();
        tracker.record(Some(LINE), 1920, 1080);
        // 24 px on the 1033 reference is 25 px at 1080.
        assert_eq!(
            tracker.next(1920, 1080),
            Some(TrackRead::Track(Region {
                x: 405,
                y: 835,
                width: 200,
                height: 70
            }))
        );
    }

    #[test]
    fn a_miss_goes_back_to_searching() {
        let mut tracker = hud();
        tracker.record(Some(LINE), 1920, 1080);
        tracker.record(None, 1920, 1080);
        assert!(matches!(
            tracker.next(1920, 1080),
            Some(TrackRead::Search(_))
        ));
    }

    #[test]
    fn a_line_seen_at_another_size_is_not_tracked() {
        let mut tracker = hud();
        tracker.record(Some(LINE), 1920, 1080);
        assert!(matches!(
            tracker.next(1920, 1056),
            Some(TrackRead::Search(_))
        ));
        assert!(matches!(
            tracker.next(1921, 1080),
            Some(TrackRead::Search(_))
        ));
        assert!(matches!(
            tracker.next(1920, 1079),
            Some(TrackRead::Search(_))
        ));
    }

    #[test]
    fn the_box_stays_inside_the_client() {
        let mut tracker = hud();
        let corner = Region {
            x: 0,
            y: 1070,
            width: 100,
            height: 10,
        };
        tracker.record(Some(corner), 1920, 1080);
        assert_eq!(
            tracker.next(1920, 1080),
            Some(TrackRead::Track(Region {
                x: 0,
                y: 1045,
                width: 125,
                height: 35
            }))
        );
    }

    #[test]
    fn an_unsupported_size_reads_nothing() {
        assert_eq!(hud().next(1280, 1024), None);
        assert_eq!(hud().next(0, 0), None);
        assert_eq!(hud().search_area(1280, 1024), None);
    }
}
