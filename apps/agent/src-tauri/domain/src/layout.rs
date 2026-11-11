//! Where the game's panels sit in the game window (AGN-02). A panel is a box measured in pixels of the reference client
//! (1920×1033, the maintainer's screenshots). D2R scales its UI with the client height, so a box is resolved by scaling
//! its x, y, width and height with `client height / 1033`, and its x is measured from its anchor: the left edge, the right
//! edge (distance from the right edge of the client to the box's right edge) or the centre line (offset of the box's left
//! edge from the centre). A frame outside the supported aspect-ratio range resolves no region, the same as F0's frame of
//! another size: nothing is read from it.

use crate::vision::Region;

/// The client size the boxes were measured on (the maintainer's screenshots, 1920×1033).
pub const REFERENCE_WIDTH: u32 = 1920;
pub const REFERENCE_HEIGHT: u32 = 1033;

/// The edge or line a panel's x is measured from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    /// x is the distance from the client's left edge to the box's left edge.
    Left,
    /// x is the distance from the client's right edge to the box's right edge.
    Right,
    /// x is the offset of the box's left edge from the client's centre line (negative to the left).
    Centre,
}

/// A panel's box in pixels of the reference client: scaled by client height / `REFERENCE_HEIGHT` when resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PanelBox {
    pub anchor: Anchor,
    pub x: i32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl PanelBox {
    pub const fn new(anchor: Anchor, x: i32, y: u32, width: u32, height: u32) -> Self {
        Self {
            anchor,
            x,
            y,
            width,
            height,
        }
    }

    /// The pixels of this box in a client of `frame_width` × `frame_height`. `None` when the client is empty, a size rounds
    /// to nothing, or the box leaves the client.
    pub fn resolve(self, frame_width: u32, frame_height: u32) -> Option<Region> {
        if frame_width == 0 || frame_height == 0 {
            return None;
        }
        let scale = f64::from(frame_height) / f64::from(REFERENCE_HEIGHT);
        let offset = (f64::from(self.x) * scale).round();
        let width = (f64::from(self.width) * scale).round();
        let height = (f64::from(self.height) * scale).round();
        let top = (f64::from(self.y) * scale).round();
        let left = match self.anchor {
            Anchor::Left => offset,
            Anchor::Right => f64::from(frame_width) - offset - width,
            Anchor::Centre => (f64::from(frame_width) / 2.0 + offset).round(),
        };
        let inside = left >= 0.0
            && top >= 0.0
            && left + width <= f64::from(frame_width)
            && top + height <= f64::from(frame_height);
        if width < 1.0 || height < 1.0 || !inside {
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

/// The box of `panel` in pixels of the reference client. The Party panel is anchored at the left edge.
pub fn panel_box(panel: PanelRegion) -> PanelBox {
    match panel {
        PanelRegion::PartyTitle => PanelBox::new(Anchor::Left, 350, 108, 100, 34),
        PanelRegion::GameNameLabel => PanelBox::new(Anchor::Left, 268, 152, 100, 18),
        PanelRegion::GameNameField => PanelBox::new(Anchor::Left, 238, 172, 156, 38),
    }
}

/// Whether a client of this size has a layout the boxes were measured for: an aspect ratio from 16:10 to 2:1, both
/// inclusive. Integer arithmetic, so the boundaries are exact.
pub fn supported_size(width: u32, height: u32) -> bool {
    if width == 0 || height == 0 {
        return false;
    }
    let (width, height) = (u64::from(width), u64::from(height));
    // 16:10 is 1.6: width / height >= 8 / 5. 2:1 is 2.0: width / height <= 2.
    width * 5 >= height * 8 && width <= height * 2
}

/// The pixels of `panel` in a client of `width` × `height`, or `None` when the size is not supported or the box does not
/// resolve on it.
pub fn panel_region(panel: PanelRegion, width: u32, height: u32) -> Option<Region> {
    if !supported_size(width, height) {
        return None;
    }
    panel_box(panel).resolve(width, height)
}

#[cfg(test)]
mod tests {
    use super::{Anchor, PanelBox, PanelRegion, panel_region, supported_size};
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

    fn field_at(width: u32, height: u32) -> Region {
        panel_region(PanelRegion::GameNameField, width, height).expect("the size is supported")
    }

    #[test]
    fn the_field_box_is_pinned_at_1920x1033() {
        assert_eq!(
            field_at(1920, 1033),
            Region {
                x: 238,
                y: 172,
                width: 156,
                height: 38,
            }
        );
    }

    #[test]
    fn the_field_box_scales_with_the_client_height_at_each_size() {
        // The reference box times client height / 1033, each value rounded: 1080 / 1033, 1440 / 1033 and 1050 / 1033.
        assert_eq!(
            field_at(1920, 1080),
            Region {
                x: 249,
                y: 180,
                width: 163,
                height: 40,
            },
            "1920×1080"
        );
        assert_eq!(
            field_at(2560, 1440),
            Region {
                x: 332,
                y: 240,
                width: 217,
                height: 53,
            },
            "2560×1440"
        );
        assert_eq!(
            field_at(1680, 1050),
            Region {
                x: 242,
                y: 175,
                width: 159,
                height: 39,
            },
            "1680×1050"
        );
    }

    #[test]
    fn the_party_panel_stays_at_the_left_edge_as_the_width_grows() {
        // A wider client moves nothing horizontally: the Party panel is anchored at the left edge.
        assert_eq!(
            field_at(2560, 1440).x,
            332,
            "scaled by height, not by width"
        );
        assert!(field_at(2560, 1440).x < 2560 / 2, "still in the left half");
    }

    #[test]
    fn a_right_anchored_box_is_measured_from_the_right_edge() {
        let right = PanelBox::new(Anchor::Right, 100, 0, 100, 10);
        assert_eq!(
            right.resolve(1920, 1033),
            Some(Region {
                x: 1720,
                y: 0,
                width: 100,
                height: 10,
            }),
            "the box's right edge is 100 px from the client's right edge"
        );
    }

    #[test]
    fn a_centre_anchored_box_is_measured_from_the_centre_line() {
        let centre = PanelBox::new(Anchor::Centre, 10, 0, 100, 10);
        assert_eq!(
            centre.resolve(1920, 1033),
            Some(Region {
                x: 970,
                y: 0,
                width: 100,
                height: 10,
            }),
            "the box starts 10 px right of the centre line at 960"
        );
    }

    #[test]
    fn a_box_that_leaves_the_client_resolves_nothing() {
        assert_eq!(
            PanelBox::new(Anchor::Left, 1900, 0, 100, 10).resolve(1920, 1033),
            None,
            "it reaches past the right edge"
        );
        assert_eq!(
            PanelBox::new(Anchor::Right, 2000, 0, 100, 10).resolve(1920, 1033),
            None,
            "its right edge starts before the left edge"
        );
    }

    #[test]
    fn a_box_that_rounds_to_nothing_or_an_empty_client_is_none() {
        assert_eq!(
            PanelBox::new(Anchor::Left, 0, 0, 0, 10).resolve(1920, 1033),
            None
        );
        assert_eq!(
            PanelBox::new(Anchor::Left, 0, 0, 1, 1).resolve(1920, 0),
            None
        );
    }

    #[test]
    fn the_panels_sit_inside_the_frame_at_each_supported_size() {
        for (width, height) in [(1920, 1033), (1920, 1080), (2560, 1440), (1680, 1050)] {
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
        for (width, height) in [(1920, 1033), (1920, 1080), (2560, 1440), (1680, 1050)] {
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
}
