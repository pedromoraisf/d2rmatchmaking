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

/// The client's regions the character screens read (CHR-04, CHR-06, CHR-18, CHR-19), measured on the maintainer's
/// 1920×1033 screenshots of 2026-11-10. A card slot is one row of the character list: slot `n` starts `CARD_PITCH` px
/// below slot `n - 1`, its frame's top border at `CARD_TOP` for slot 0. The list is anchored to the right edge, the
/// "Select Difficulty" popup to the centre line, the HUD markers to the left and the top-right corner.
pub const CARD_SLOTS: u8 = 9;
const CARD_TOP: u32 = 46;
const CARD_PITCH: u32 = 90;

/// A region of a character screen. The text regions are read with the language pack's words; `CardSelected` is sampled
/// for the gold frame of the selected card and is never sent to the OCR engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenRegion {
    /// The "Create New" button, bottom right of the character list (the selection screen's marker).
    CreateNew,
    /// The "Life:" label above the health globe (the in-game marker).
    Life,
    /// The "Difficulty:" line of the automap's area block, top right (the automap's marker).
    AreaDifficulty,
    /// The "Select Difficulty" title of the popup.
    SelectDifficulty,
    /// The Normal, Nightmare and Hell buttons of the popup: a difficulty is enabled when its label reads and is bright.
    PopupNormal,
    PopupNightmare,
    PopupHell,
    /// The title line, the name and the "Level N Class" line of a card.
    CardTitle(u8),
    CardName(u8),
    CardLevel(u8),
    /// The top border of a card: gold when the card is the selected one.
    CardSelected(u8),
}

fn card_top(slot: u8) -> u32 {
    CARD_TOP + CARD_PITCH * u32::from(slot)
}

/// The box of a screen region in pixels of the reference client.
pub fn screen_box(region: ScreenRegion) -> PanelBox {
    use Anchor::{Centre, Left, Right};
    match region {
        ScreenRegion::CreateNew => PanelBox::new(Right, 130, 882, 140, 22),
        ScreenRegion::Life => PanelBox::new(Left, 400, 826, 160, 22),
        ScreenRegion::AreaDifficulty => PanelBox::new(Right, 20, 52, 150, 16),
        ScreenRegion::SelectDifficulty => PanelBox::new(Centre, -108, 344, 216, 18),
        ScreenRegion::PopupNormal => PanelBox::new(Centre, -100, 412, 200, 20),
        ScreenRegion::PopupNightmare => PanelBox::new(Centre, -100, 476, 200, 20),
        ScreenRegion::PopupHell => PanelBox::new(Centre, -100, 540, 200, 20),
        ScreenRegion::CardTitle(slot) => PanelBox::new(Right, 108, card_top(slot) + 6, 236, 18),
        ScreenRegion::CardName(slot) => PanelBox::new(Right, 108, card_top(slot) + 36, 236, 18),
        ScreenRegion::CardLevel(slot) => PanelBox::new(Right, 108, card_top(slot) + 58, 236, 18),
        ScreenRegion::CardSelected(slot) => PanelBox::new(Right, 210, card_top(slot) - 1, 20, 3),
    }
}

/// The pixels of a screen region in a client of `width` × `height`, or `None` when the size is not supported or the
/// region does not resolve on it (CHR-19: an unsupported aspect ratio reads nothing).
pub fn screen_region(region: ScreenRegion, width: u32, height: u32) -> Option<Region> {
    if !supported_size(width, height) {
        return None;
    }
    screen_box(region).resolve(width, height)
}

impl ScreenRegion {
    /// The key of the region in a fixture's sidecar (`<png>.json`), camelCase, as the drawn fixtures name it.
    pub fn key(self) -> String {
        match self {
            ScreenRegion::CreateNew => "createNew".to_string(),
            ScreenRegion::Life => "life".to_string(),
            ScreenRegion::AreaDifficulty => "areaDifficulty".to_string(),
            ScreenRegion::SelectDifficulty => "selectDifficulty".to_string(),
            ScreenRegion::PopupNormal => "popupNormal".to_string(),
            ScreenRegion::PopupNightmare => "popupNightmare".to_string(),
            ScreenRegion::PopupHell => "popupHell".to_string(),
            ScreenRegion::CardTitle(slot) => format!("cardTitle{slot}"),
            ScreenRegion::CardName(slot) => format!("cardName{slot}"),
            ScreenRegion::CardLevel(slot) => format!("cardLevel{slot}"),
            ScreenRegion::CardSelected(slot) => format!("cardSelected{slot}"),
        }
    }
}

/// The regions the OCR engine reads on a character screen, in a fixed order: the markers, the popup and the card fields
/// of every slot. `CardSelected` is not among them: it is a pixel sample.
pub fn screen_text_regions() -> Vec<ScreenRegion> {
    let mut regions = vec![
        ScreenRegion::CreateNew,
        ScreenRegion::Life,
        ScreenRegion::AreaDifficulty,
        ScreenRegion::SelectDifficulty,
        ScreenRegion::PopupNormal,
        ScreenRegion::PopupNightmare,
        ScreenRegion::PopupHell,
    ];
    for slot in 0..CARD_SLOTS {
        regions.push(ScreenRegion::CardTitle(slot));
        regions.push(ScreenRegion::CardName(slot));
        regions.push(ScreenRegion::CardLevel(slot));
    }
    regions
}

#[cfg(test)]
mod screen_tests {
    use super::{CARD_SLOTS, ScreenRegion, screen_region, screen_text_regions};
    use crate::vision::Region;

    fn at(region: ScreenRegion, width: u32, height: u32) -> Region {
        screen_region(region, width, height).expect("the size is supported and the region resolves")
    }

    #[test]
    fn the_markers_are_pinned_at_1920x1033() {
        assert_eq!(
            at(ScreenRegion::CreateNew, 1920, 1033),
            Region {
                x: 1650,
                y: 882,
                width: 140,
                height: 22
            }
        );
        assert_eq!(
            at(ScreenRegion::Life, 1920, 1033),
            Region {
                x: 400,
                y: 826,
                width: 160,
                height: 22
            }
        );
        assert_eq!(
            at(ScreenRegion::AreaDifficulty, 1920, 1033),
            Region {
                x: 1750,
                y: 52,
                width: 150,
                height: 16
            }
        );
    }

    #[test]
    fn the_popup_is_pinned_at_1920x1033_around_the_centre_line() {
        assert_eq!(
            at(ScreenRegion::SelectDifficulty, 1920, 1033),
            Region {
                x: 852,
                y: 344,
                width: 216,
                height: 18
            }
        );
        assert_eq!(
            at(ScreenRegion::PopupNormal, 1920, 1033),
            Region {
                x: 860,
                y: 412,
                width: 200,
                height: 20
            }
        );
        assert_eq!(
            at(ScreenRegion::PopupHell, 1920, 1033),
            Region {
                x: 860,
                y: 540,
                width: 200,
                height: 20
            }
        );
    }

    #[test]
    fn the_card_rows_are_pinned_at_1920x1033() {
        assert_eq!(
            at(ScreenRegion::CardTitle(0), 1920, 1033),
            Region {
                x: 1576,
                y: 52,
                width: 236,
                height: 18
            }
        );
        assert_eq!(
            at(ScreenRegion::CardName(0), 1920, 1033),
            Region {
                x: 1576,
                y: 82,
                width: 236,
                height: 18
            }
        );
        assert_eq!(
            at(ScreenRegion::CardLevel(0), 1920, 1033),
            Region {
                x: 1576,
                y: 104,
                width: 236,
                height: 18
            }
        );
        // The second slot is 90 px lower: its name is at 172, where the second card's name is drawn.
        assert_eq!(at(ScreenRegion::CardName(1), 1920, 1033).y, 172);
        assert_eq!(
            at(ScreenRegion::CardSelected(0), 1920, 1033),
            Region {
                x: 1690,
                y: 45,
                width: 20,
                height: 3
            }
        );
    }

    #[test]
    fn the_card_fields_of_a_row_sit_top_to_bottom_and_the_rows_do_not_overlap() {
        for (width, height) in [(1920, 1033), (1920, 1080), (2560, 1440), (1680, 1050)] {
            for slot in 0..CARD_SLOTS {
                let title = at(ScreenRegion::CardTitle(slot), width, height);
                let name = at(ScreenRegion::CardName(slot), width, height);
                let level = at(ScreenRegion::CardLevel(slot), width, height);
                assert!(
                    title.y + title.height <= name.y,
                    "title above name at {height}"
                );
                assert!(
                    name.y + name.height <= level.y,
                    "name above level at {height}"
                );
                if slot + 1 < CARD_SLOTS {
                    let next = at(ScreenRegion::CardTitle(slot + 1), width, height);
                    assert!(
                        level.y + level.height <= next.y,
                        "rows do not overlap at {height}"
                    );
                }
            }
        }
    }

    #[test]
    fn every_text_region_resolves_inside_the_frame_at_each_supported_size() {
        for (width, height) in [(1920, 1033), (1920, 1080), (2560, 1440), (1680, 1050)] {
            for region in screen_text_regions() {
                let pixels = at(region, width, height);
                assert!(
                    pixels.x + pixels.width <= width && pixels.y + pixels.height <= height,
                    "{region:?} at {width}×{height} lies inside the frame"
                );
            }
        }
    }

    #[test]
    fn an_unsupported_aspect_ratio_resolves_no_screen_region() {
        assert_eq!(screen_region(ScreenRegion::CardName(0), 1280, 1024), None);
        assert_eq!(screen_region(ScreenRegion::Life, 2560, 1080), None);
    }

    #[test]
    fn the_keys_name_each_region_once() {
        let keys: Vec<String> = screen_text_regions()
            .into_iter()
            .map(ScreenRegion::key)
            .collect();
        let mut unique = keys.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), keys.len());
        assert_eq!(keys[0], "createNew");
        assert_eq!(keys.last().map(String::as_str), Some("cardLevel8"));
    }
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
