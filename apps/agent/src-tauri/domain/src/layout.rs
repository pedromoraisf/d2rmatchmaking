//! Where the game's panels sit in the game window (AGN-02). A region is a fraction of the client size, measured from the
//! top-left corner, so one definition serves every supported client size. The Party panel is anchored at the left edge
//! and keeps its size, so its fractions are measured from that edge. A frame outside the supported aspect-ratio range
//! resolves no region, the same as F0's frame of another size: nothing is read from it.

use crate::vision::Region;

/// The client size the regions were measured on (the maintainer's screenshots, 1920×1033).
pub const REFERENCE_WIDTH: u32 = 1920;
pub const REFERENCE_HEIGHT: u32 = 1033;

/// A region as fractions of the client size: each value is in 0..=1 and `x + width <= 1`, `y + height <= 1`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RelRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl RelRegion {
    /// A region measured in pixels of the reference client, stored as fractions of it.
    pub const fn from_reference(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x: x as f64 / REFERENCE_WIDTH as f64,
            y: y as f64 / REFERENCE_HEIGHT as f64,
            width: width as f64 / REFERENCE_WIDTH as f64,
            height: height as f64 / REFERENCE_HEIGHT as f64,
        }
    }

    /// The pixels of this region in a client of `frame_width` × `frame_height`. `None` when the edges round to an empty
    /// rectangle.
    pub fn resolve(self, frame_width: u32, frame_height: u32) -> Option<Region> {
        let left = (self.x * f64::from(frame_width)).round();
        let top = (self.y * f64::from(frame_height)).round();
        let right = ((self.x + self.width) * f64::from(frame_width)).round();
        let bottom = ((self.y + self.height) * f64::from(frame_height)).round();
        let width = right - left;
        let height = bottom - top;
        if width < 1.0 || height < 1.0 {
            return None;
        }
        Some(Region {
            x: left as u32,
            y: top as u32,
            width: width as u32,
            height: height as u32,
        })
    }
}

/// The panel regions the agent reads, by name. A language pack supplies the words that go with them; the region is the
/// same in every language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelRegion {
    /// The title of the Party panel ("Party").
    PartyTitle,
    /// The label above the Game Name field.
    GameNameLabel,
    /// The Game Name field, which shows the game name or its masked form.
    GameNameField,
}

/// The region of `panel` as fractions of the client size, measured on the reference client.
pub fn rel_region(panel: PanelRegion) -> RelRegion {
    match panel {
        PanelRegion::PartyTitle => RelRegion::from_reference(350, 108, 100, 34),
        PanelRegion::GameNameLabel => RelRegion::from_reference(268, 152, 100, 18),
        PanelRegion::GameNameField => RelRegion::from_reference(238, 172, 156, 38),
    }
}

/// Whether a client of this size has a layout the regions were measured for: an aspect ratio from 16:10 to 2:1, both
/// inclusive. Integer arithmetic, so the boundaries are exact.
pub fn supported_size(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    let (width, height) = (u64::from(width), u64::from(height));
    // 16:10 is 1.6: width / height >= 8 / 5. 2:1 is 2.0: width / height <= 2.
    width * 5 >= height * 8 && width <= height * 2
}

/// The pixels of `panel` in a client of `width` × `height`, or `None` when the size is not supported or the region
/// collapses on it.
pub fn panel_region(panel: PanelRegion, width: u32, height: u32) -> Option<Region> {
    if !supported_size(width, height) {
        return None;
    }
    rel_region(panel).resolve(width, height)
}

#[cfg(test)]
mod tests {
    use super::{PanelRegion, RelRegion, panel_region, rel_region, supported_size};
    use crate::vision::Region;

    const PANELS: [PanelRegion; 3] = [
        PanelRegion::PartyTitle,
        PanelRegion::GameNameLabel,
        PanelRegion::GameNameField,
    ];

    fn inside(outer: Region, inner: Region) -> bool {
        inner.x >= outer.x
            && inner.y >= outer.y
            && inner.x + inner.width <= outer.x + outer.width
            && inner.y + inner.height <= outer.y + outer.height
    }

    fn frame(width: u32, height: u32) -> Region {
        Region {
            x: 0,
            y: 0,
            width,
            height,
        }
    }

    #[test]
    fn the_field_region_is_pinned_at_1920x1033() {
        // The field as measured on the 1920×1033 screenshot: its frame sits at x 240..392, y 175..206 (inside 238..394,
        // 172..210).
        let field =
            panel_region(PanelRegion::GameNameField, 1920, 1033).expect("1920×1033 is supported");
        assert_eq!(
            field,
            Region {
                x: 238,
                y: 172,
                width: 156,
                height: 38,
            }
        );
    }

    #[test]
    fn panels_sit_inside_the_frame_at_1920x1033_and_1920x1080() {
        for (width, height) in [(1920, 1033), (1920, 1080)] {
            for panel in PANELS {
                let region = panel_region(panel, width, height).expect("the size is supported");
                assert!(
                    inside(frame(width, height), region),
                    "{panel:?} at {width}×{height} lies inside the frame"
                );
            }
        }
    }

    #[test]
    fn the_title_sits_above_the_label_and_the_label_above_the_field() {
        for (width, height) in [(1920, 1033), (1920, 1080)] {
            let title = panel_region(PanelRegion::PartyTitle, width, height).expect("supported");
            let label = panel_region(PanelRegion::GameNameLabel, width, height).expect("supported");
            let field = panel_region(PanelRegion::GameNameField, width, height).expect("supported");
            assert!(
                title.y + title.height <= label.y,
                "title above label at {height}"
            );
            assert!(
                label.y + label.height <= field.y,
                "label above field at {height}"
            );
        }
    }

    #[test]
    fn the_regions_scale_with_the_client_height() {
        let at_1033 = panel_region(PanelRegion::GameNameField, 1920, 1033).expect("supported");
        let at_1080 = panel_region(PanelRegion::GameNameField, 1920, 1080).expect("supported");
        assert!(
            at_1080.y > at_1033.y,
            "the field sits lower on a taller client"
        );
        assert_eq!(
            at_1080.x, at_1033.x,
            "the panel is anchored at the left edge"
        );
    }

    #[test]
    fn an_aspect_ratio_outside_the_range_resolves_nothing() {
        for (width, height) in [
            (1280, 1024),
            (1440, 1080),
            (2560, 1080),
            (3440, 1440),
            (1080, 1920),
        ] {
            assert!(
                !supported_size(width, height),
                "{width}×{height} is outside the range"
            );
            for panel in PANELS {
                assert_eq!(panel_region(panel, width, height), None, "{width}×{height}");
            }
        }
    }

    #[test]
    fn the_aspect_ratio_range_is_inclusive_at_16_10_and_2_1() {
        assert!(supported_size(1600, 1000), "16:10 is in the range");
        assert!(supported_size(1999, 1000), "just under 2:1 is in the range");
        assert!(supported_size(2000, 1000), "2:1 is in the range");
        assert!(
            !supported_size(1599, 1000),
            "just narrower than 16:10 is out"
        );
        assert!(!supported_size(2001, 1000), "just wider than 2:1 is out");
    }

    #[test]
    fn an_empty_client_is_not_supported() {
        assert!(!supported_size(0, 0));
        assert!(!supported_size(1920, 0));
        assert!(!supported_size(0, 1080));
    }

    #[test]
    fn rel_regions_stay_within_the_unit_square() {
        for panel in PANELS {
            let RelRegion {
                x,
                y,
                width,
                height,
            } = rel_region(panel);
            assert!(
                (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y),
                "{panel:?} starts inside"
            );
            assert!(
                x + width <= 1.0 && y + height <= 1.0,
                "{panel:?} ends inside"
            );
        }
    }

    #[test]
    fn a_region_that_rounds_to_nothing_is_none() {
        let sliver = RelRegion {
            x: 0.5,
            y: 0.5,
            width: 0.0001,
            height: 0.0001,
        };
        assert_eq!(sliver.resolve(1920, 1080), None);
    }
}
