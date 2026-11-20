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

/// How many frames apart the automap's wide area is searched while its line is not found (NFR-03 CPU). The agent looks at
/// the game once a second (`watch_screen::TICK`), so an automap opened between two searches shows within this many seconds;
/// a frame that rests reads nothing for it. The HUD's band is searched every frame (`Tracker::new`).
pub const AUTOMAP_SEARCH_EVERY: u32 = 2;

/// Where a label was last seen, and in a client of what size, with the area it is searched in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tracker {
    search: ScreenRegion,
    seen: Option<(Region, u32, u32)>,
    /// A search of the area happens at most once in this many frames while the label is not found (1: every frame).
    every: u32,
    /// How many of the next searches still rest, after a search that found nothing, and the client size it found it in.
    resting: u32,
    rest_size: (u32, u32),
}

impl Tracker {
    /// A tracker that has seen nothing, searching `search` (a wide area such as `ScreenRegion::HudBand`) on every frame
    /// while the label is not found.
    pub fn new(search: ScreenRegion) -> Self {
        Self::searching_every(search, 1)
    }

    /// A tracker that searches `search` at most once in `every` frames while the label is not found (`every` of 0 counts as
    /// 1). A tracked box is read on every frame, and a find or a size change searches at once.
    pub fn searching_every(search: ScreenRegion, every: u32) -> Self {
        Self {
            search,
            seen: None,
            every: every.max(1),
            resting: 0,
            rest_size: (0, 0),
        }
    }

    /// Whether the search planned for a frame of `width` × `height` rests: true (and one rest used) when the last search
    /// found nothing in a client of that size and fewer than `every` frames have passed. A client of another size searches
    /// at once. Called only for a `TrackRead::Search` frame.
    pub fn rests(&mut self, width: u32, height: u32) -> bool {
        if self.resting == 0 {
            return false;
        }
        if self.rest_size != (width, height) {
            self.resting = 0;
            return false;
        }
        self.resting -= 1;
        true
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
        self.resting = if found.is_some() { 0 } else { self.every - 1 };
        self.rest_size = (width, height);
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
    fn a_tracker_that_searches_every_frame_never_rests() {
        let mut tracker = hud();
        for _ in 0..3 {
            tracker.record(None, 1920, 1080);
            assert!(!tracker.rests(1920, 1080));
        }
    }

    #[test]
    fn a_tracker_that_searches_every_second_frame_rests_one_search_after_a_miss() {
        let mut tracker = Tracker::searching_every(ScreenRegion::AutomapArea, 2);
        assert!(!tracker.rests(1920, 1080), "nothing missed yet: search");
        tracker.record(None, 1920, 1080);
        assert!(tracker.rests(1920, 1080), "the next search rests");
        assert!(
            !tracker.rests(1920, 1080),
            "and the one after it reads the area"
        );
        tracker.record(None, 1920, 1080);
        assert!(tracker.rests(1920, 1080), "a new miss rests again");
    }

    #[test]
    fn a_tracker_that_searches_every_third_frame_rests_two() {
        let mut tracker = Tracker::searching_every(ScreenRegion::AutomapArea, 3);
        tracker.record(None, 1920, 1080);
        assert!(tracker.rests(1920, 1080));
        assert!(tracker.rests(1920, 1080));
        assert!(!tracker.rests(1920, 1080));
    }

    #[test]
    fn a_find_ends_the_rest_and_a_zero_period_counts_as_one() {
        let mut tracker = Tracker::searching_every(ScreenRegion::AutomapArea, 2);
        tracker.record(None, 1920, 1080);
        tracker.record(Some(LINE), 1920, 1080);
        assert!(!tracker.rests(1920, 1080));
        let mut every_frame = Tracker::searching_every(ScreenRegion::AutomapArea, 0);
        every_frame.record(None, 1920, 1080);
        assert!(!every_frame.rests(1920, 1080));
    }

    #[test]
    fn a_client_of_another_size_searches_at_once() {
        let mut tracker = Tracker::searching_every(ScreenRegion::AutomapArea, 2);
        tracker.record(None, 1920, 1080);
        assert!(!tracker.rests(1920, 1056));
        assert!(!tracker.rests(1920, 1080), "the rest was dropped");
    }

    #[test]
    fn the_automap_area_is_searched_every_second_frame() {
        assert_eq!(super::AUTOMAP_SEARCH_EVERY, 2);
    }

    #[test]
    fn an_unsupported_size_reads_nothing() {
        assert_eq!(hud().next(1280, 1024), None);
        assert_eq!(hud().next(0, 0), None);
        assert_eq!(hud().search_area(1280, 1024), None);
    }
}
