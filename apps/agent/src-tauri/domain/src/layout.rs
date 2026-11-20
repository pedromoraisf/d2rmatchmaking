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
    /// The title of the Party panel ("Party"). Fixtures and sidecars only: the agent reads `PartyPanel`.
    PartyTitle,
    /// The label above the Game Name field. Fixtures and sidecars only.
    GameNameLabel,
    /// The Game Name field, which shows the game name or its masked form. Fixtures and sidecars only.
    GameNameField,
    /// The area the Party panel's lines are searched in (`anchors::find_party`): the title, the Game Name label and its
    /// field, in the maximized and in the full-screen client. The area may also include the "Password" label; its text is never
    /// used, matched, returned, logged or sent (the lines are read once, and only the title, the Game Name label and the
    /// field are looked for). The three boxes above are where the drawn fixtures put the text; the agent does not read them.
    PartyPanel,
    /// The first, cheap area the Party lines are searched in: the box measured on the 1033 English client (title, label and
    /// field). `PartyPanel` is read only when this one finds no title or no label, and the box found there is tracked.
    PartyFixed,
}

/// The box of `panel` in pixels of the reference client. The Party panel is anchored at the left edge.
pub fn panel_box(panel: PanelRegion) -> PanelBox {
    match panel {
        PanelRegion::PartyTitle => PanelBox::new(Anchor::Left, 350, 108, 100, 34),
        PanelRegion::GameNameLabel => PanelBox::new(Anchor::Left, 268, 152, 100, 18),
        PanelRegion::GameNameField => PanelBox::new(Anchor::Left, 238, 172, 156, 38),
        PanelRegion::PartyPanel => PanelBox::new(Anchor::Left, 0, 0, 576, 413),
        PanelRegion::PartyFixed => PanelBox::new(Anchor::Left, 230, 100, 250, 170),
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
    /// The "Select Difficulty" title of the popup. Fixtures and sidecars only: the agent reads `PopupArea` and finds the
    /// title by its text.
    SelectDifficulty,
    /// The Normal, Nightmare and Hell buttons of the popup: a difficulty is enabled when its label reads and is bright.
    /// Fixtures and sidecars only: the agent finds the options by their words in `PopupArea` (and samples the brightness
    /// of the box it found).
    PopupNormal,
    PopupNightmare,
    PopupHell,
    /// The title line, the name and the "Level N Class" line of a card. Fixtures and sidecars only: the agent finds a card's
    /// lines by the text of the lines in `CardColumn`.
    CardTitle(u8),
    CardName(u8),
    CardLevel(u8),
    /// The top border of a card: gold when the card is the selected one.
    CardSelected(u8),
    /// The right-hand column the character list sits in, from under the top edge to above "Create New": the area the card
    /// lines are searched in (`anchors::find_cards`), whatever the client's mode (maximized or full screen).
    CardColumn,
    /// The area of the popup's title and options, around the centre line (`anchors::popup_options`).
    PopupArea,
    /// The full-width band along the bottom of the client, where the Life and Mana labels of the in-game HUD are searched
    /// by their words (`anchors::find_hud`): the fixed "Life:" box missed in both window and full screen, because D2R does
    /// not scale its HUD linearly between the two. Its width is the client's, whatever the aspect ratio.
    HudBand,
    /// The top-right corner where the automap's area block sits, searched for its "Difficulty:" line by its word
    /// (`anchors::find_automap`) when the fixed `AreaDifficulty` box misses: a fallback, the fixed box stays the first check.
    AutomapArea,
    /// The bottom-right corner where the character list's "Create New" button sits, searched for its word
    /// (`anchors::find_create_new`) when the fixed `CreateNew` box misses: a fallback, the fixed box stays the first check.
    /// The button is at 882 to 904 on the reference client; the area reaches 80 px above and below it for the drift of the
    /// window, borderless and full-screen layouts and of a client a few pixels taller or shorter.
    CreateNewArea,
}

/// The top of `ScreenRegion::HudBand` in pixels of the reference client: the bottom quarter. The "Life:" label sits at
/// 826 to 848 there (80% of the height), the Mana label level with it on the right; the 5% above it absorbs the shift of
/// the full-screen layout.
const HUD_BAND_TOP: u32 = 775;

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
        ScreenRegion::CardColumn => PanelBox::new(Right, 40, 30, 340, 850),
        ScreenRegion::PopupArea => PanelBox::new(Centre, -130, 320, 260, 290),
        ScreenRegion::AutomapArea => PanelBox::new(Right, 0, 20, 560, 220),
        ScreenRegion::CreateNewArea => PanelBox::new(Right, 0, 800, 560, 220),
        // The width is the client's: `screen_region` replaces it.
        ScreenRegion::HudBand => PanelBox::new(
            Left,
            0,
            HUD_BAND_TOP,
            REFERENCE_WIDTH,
            REFERENCE_HEIGHT - HUD_BAND_TOP,
        ),
    }
}

/// The band to sample for the gold frame of the card whose name line is `name`: the card's top border sits 44.5 px above
/// the middle of its name on the reference client, so the band spans 52 to 38 px above it (scaled with the client height).
/// A card's other lines are at least 38 px from that band's rows of the card above. `None` when the size is not supported
/// or the band leaves the frame.
pub fn selection_band(name: Region, width: u32, height: u32) -> Option<Region> {
    if !supported_size(width, height) {
        return None;
    }
    let above = |reference: f64| {
        (reference * f64::from(height) / f64::from(REFERENCE_HEIGHT)).round() as u32
    };
    let top = name.middle_y().checked_sub(above(52.0))?;
    let band = above(14.0).max(1);
    let border = screen_region(ScreenRegion::CardSelected(0), width, height)?;
    (top + band <= height).then_some(Region {
        x: border.x,
        y: top,
        width: border.width,
        height: band,
    })
}

/// The pixels of a screen region in a client of `width` × `height`, or `None` when the size is not supported or the
/// region does not resolve on it (CHR-19: an unsupported aspect ratio reads nothing).
pub fn screen_region(region: ScreenRegion, width: u32, height: u32) -> Option<Region> {
    if !supported_size(width, height) {
        return None;
    }
    if region == ScreenRegion::HudBand {
        // Full width, from the reference top scaled with the height down to the bottom edge of the client.
        let top = (f64::from(HUD_BAND_TOP) * f64::from(height) / f64::from(REFERENCE_HEIGHT))
            .round() as u32;
        return Some(Region {
            x: 0,
            y: top,
            width,
            height: height - top,
        });
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
            ScreenRegion::CardColumn => "cardColumn".to_string(),
            ScreenRegion::PopupArea => "popupArea".to_string(),
            ScreenRegion::HudBand => "hudBand".to_string(),
            ScreenRegion::AutomapArea => "automapArea".to_string(),
            ScreenRegion::CreateNewArea => "createNewArea".to_string(),
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
    use super::{CARD_SLOTS, ScreenRegion, screen_region, screen_text_regions, selection_band};
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
    fn the_search_areas_hold_the_measured_lines_of_both_clients() {
        let holds = |area: Region, x: u32, y: u32| {
            area.x <= x && x < area.x + area.width && area.y <= y && y < area.y + area.height
        };
        // The full-screen 1920×1080 print: tabs, titled card, the second card's level line; the popup's title and Hell.
        let column = at(ScreenRegion::CardColumn, 1920, 1080);
        for (x, y) in [(1560, 53), (1700, 87), (1860, 141), (1700, 233)] {
            assert!(holds(column, x, y), "({x}, {y}) is in the card column");
        }
        let popup = at(ScreenRegion::PopupArea, 1920, 1080);
        for (x, y) in [(960, 385), (960, 455), (960, 586)] {
            assert!(holds(popup, x, y), "({x}, {y}) is in the popup area");
        }
        // The reference 1920×1033 client: the first card's title, the last slot's level line, the popup's Hell.
        let column = at(ScreenRegion::CardColumn, 1920, 1033);
        assert!(holds(column, 1700, 61) && holds(column, 1700, 90 * 8 + 104));
        assert!(holds(at(ScreenRegion::PopupArea, 1920, 1033), 960, 550));
        // The column ends above "Create New", at every supported size.
        for (width, height) in [(1920, 1033), (1920, 1080), (2560, 1440)] {
            let column = at(ScreenRegion::CardColumn, width, height);
            let create = at(ScreenRegion::CreateNew, width, height);
            assert!(column.y + column.height <= create.y);
        }
    }

    #[test]
    fn the_hud_band_is_the_bottom_quarter_at_the_full_width_of_every_client() {
        let band = |width: u32, height: u32| at(ScreenRegion::HudBand, width, height);
        assert_eq!(
            band(1920, 1033),
            Region {
                x: 0,
                y: 775,
                width: 1920,
                height: 258
            }
        );
        // The window and the full screen: the Life label (826 on the reference, 80% of the height) is inside both.
        for (width, height) in [(1920, 1056), (1920, 1080)] {
            let area = band(width, height);
            let label = height * 826 / 1033;
            assert_eq!(
                (area.x, area.width, area.y + area.height),
                (0, width, height)
            );
            assert!(area.y <= label && label + 22 <= height);
            assert!(
                area.y > height * 7 / 10,
                "a quarter of the client, not more"
            );
        }
        assert_eq!(band(2560, 1440).width, 2560);
        assert_eq!(screen_region(ScreenRegion::HudBand, 1280, 1024), None);
    }

    #[test]
    fn the_automap_area_holds_the_fixed_difficulty_line_of_every_client() {
        // The area is where the automap's difficulty line is searched by its word when the fixed box misses: it contains
        // that box at every height of the maintainer's prints and stays at the top right.
        for height in [1033, 1045, 1056, 1080] {
            let area = at(ScreenRegion::AutomapArea, 1920, height);
            let line = at(ScreenRegion::AreaDifficulty, 1920, height);
            assert!(
                area.x <= line.x
                    && line.right() <= area.right()
                    && area.y <= line.y
                    && line.bottom() <= area.bottom(),
                "at {height}"
            );
            assert_eq!(area.right(), 1920, "anchored to the right edge");
            assert!(area.bottom() < height / 4, "a corner, not a half: {height}");
        }
        assert_eq!(
            at(ScreenRegion::AutomapArea, 1920, 1033),
            Region {
                x: 1360,
                y: 20,
                width: 560,
                height: 220
            }
        );
    }

    #[test]
    fn the_create_new_area_holds_the_fixed_marker_of_every_client_and_stays_at_the_bottom_right() {
        // Where the marker is searched by its word when the fixed box misses: it contains that box at every height of the
        // maintainer's prints, reaches the right edge and is a corner, not a half.
        for height in [1033, 1045, 1056, 1080] {
            let area = at(ScreenRegion::CreateNewArea, 1920, height);
            let marker = at(ScreenRegion::CreateNew, 1920, height);
            assert!(
                area.x <= marker.x
                    && marker.right() <= area.right()
                    && area.y <= marker.y
                    && marker.bottom() <= area.bottom(),
                "at {height}"
            );
            assert_eq!(area.right(), 1920, "anchored to the right edge");
            assert!(area.bottom() < height, "inside the client: {height}");
            assert!(area.y > height / 2, "the bottom half only: {height}");
        }
        assert_eq!(
            at(ScreenRegion::CreateNewArea, 1920, 1033),
            Region {
                x: 1360,
                y: 800,
                width: 560,
                height: 220
            }
        );
        assert_eq!(screen_region(ScreenRegion::CreateNewArea, 1280, 1024), None);
    }

    #[test]
    fn the_gold_band_follows_the_name_line_not_a_fixed_slot() {
        // The reference client: the border of slot 0 is at 45..48 and its name line is centred on 91.
        let name = Region {
            x: 1576,
            y: 82,
            width: 236,
            height: 18,
        };
        let band = selection_band(name, 1920, 1033).expect("inside the frame");
        assert_eq!((band.y, band.height), (39, 14));
        assert!(
            band.y <= 45 && 48 <= band.y + band.height,
            "the border is in the band"
        );
        assert_eq!((band.x, band.width), (1690, 20));
        // The same card in the full-screen client, its name line centred on 118.
        let name = Region {
            x: 1560,
            y: 109,
            width: 120,
            height: 18,
        };
        let band = selection_band(name, 1920, 1080).expect("inside the frame");
        assert_eq!((band.y, band.height), (118 - 54, 15));
        assert_eq!(selection_band(name, 1280, 1024), None, "unsupported size");
        let high = Region { y: 10, ..name };
        assert_eq!(selection_band(high, 1920, 1080), None, "above the frame");
    }

    /// ocr-protection: the Nightmare option is pinned beside Normal and Hell, left of the centre line like them.
    #[test]
    fn the_nightmare_option_is_pinned_at_1920x1033_left_of_the_centre_line() {
        assert_eq!(
            at(ScreenRegion::PopupNightmare, 1920, 1033),
            Region {
                x: 860,
                y: 476,
                width: 200,
                height: 20
            }
        );
    }

    /// ocr-protection: the gold band of the last slot, whose name line sits low on the reference client, is inside the frame
    /// and holds that card's border (slot 8: border at 765..768, name line centred on 811).
    #[test]
    fn the_gold_band_of_the_last_slot_is_inside_the_frame_and_holds_its_border() {
        let name = at(ScreenRegion::CardName(8), 1920, 1033);
        assert_eq!(name.middle_y(), 811);
        let band = selection_band(name, 1920, 1033).expect("inside the frame");
        assert_eq!((band.y, band.height), (759, 14));
        let border = at(ScreenRegion::CardSelected(8), 1920, 1033);
        assert!(
            band.y <= border.y && border.bottom() <= band.bottom(),
            "the border is in the band"
        );
    }

    /// ocr-protection: a name line so low that its band would pass the bottom edge has no band; one whose band ends on the
    /// last row has one.
    #[test]
    fn the_gold_band_must_end_on_or_before_the_last_row() {
        let line = |middle: u32| Region {
            x: 1576,
            y: middle - 9,
            width: 236,
            height: 18,
        };
        // The band spans middle - 52 to middle - 38 (14 rows): it ends on the frame's last row at middle 1071.
        let band = selection_band(line(1071), 1920, 1033).expect("the band ends on the last row");
        assert_eq!((band.y, band.bottom()), (1019, 1033));
        assert_eq!(selection_band(line(1072), 1920, 1033), None);
        assert_eq!(selection_band(line(1090), 1920, 1033), None);
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

    /// ocr-protection: a box ends on the last row or column of the client and not one pixel past it, and a size that
    /// rounds to one pixel is still a box.
    #[test]
    fn a_box_may_end_on_the_edge_of_the_client_but_not_past_it() {
        let at_edge = |anchor, x, y, width, height| {
            PanelBox::new(anchor, x, y, width, height).resolve(1920, 1033)
        };
        // Past the bottom edge: the box would be inside if its height were taken from its top.
        assert_eq!(at_edge(Anchor::Left, 0, 1030, 10, 10), None);
        assert_eq!(
            at_edge(Anchor::Left, 0, 1023, 10, 10),
            Some(Region {
                x: 0,
                y: 1023,
                width: 10,
                height: 10
            }),
            "ends on the last row"
        );
        assert_eq!(at_edge(Anchor::Left, 0, 1024, 10, 10), None);
        // Past the right edge, and ending on it.
        assert_eq!(
            at_edge(Anchor::Left, 1815, 0, 100, 10),
            Some(Region {
                x: 1815,
                y: 0,
                width: 100,
                height: 10
            })
        );
        assert_eq!(at_edge(Anchor::Left, 1821, 0, 100, 10), None);
        // A box one pixel wide and high is a box; one that rounds to no height is none.
        assert_eq!(
            at_edge(Anchor::Left, 5, 5, 1, 1),
            Some(Region {
                x: 5,
                y: 5,
                width: 1,
                height: 1
            })
        );
        assert_eq!(at_edge(Anchor::Left, 5, 5, 10, 0), None);
        assert_eq!(at_edge(Anchor::Left, 5, 5, 0, 10), None);
    }
}

#[cfg(test)]
mod pin_fixed_boxes {
    use super::{PanelRegion, ScreenRegion, panel_region, screen_region};

    use crate::vision::Region;

    const fn r(x: u32, y: u32, width: u32, height: u32) -> Region {
        Region {
            x,
            y,
            width,
            height,
        }
    }

    /// The fixed boxes of the Party panel, the Life label and the area's difficulty line at the client heights of the
    /// maintainer's prints (1033 maximized, 1045, 1056 window, 1080 full screen): they follow the height linearly, which is
    /// what a client that does not scale its panels linearly outgrows (screen-recognition SCR-01, SCR-03, SCR-04).
    #[test]
    fn the_fixed_boxes_follow_the_client_height_linearly() {
        let party = |height| panel_region(PanelRegion::PartyPanel, 1920, height);
        let life = |height| screen_region(ScreenRegion::Life, 1920, height);
        let area = |height| screen_region(ScreenRegion::AreaDifficulty, 1920, height);
        // Changed expectation (screen-recognition T6, SCR-04): the Party lines are searched in the wide top-left area.
        assert_eq!(party(1033), Some(r(0, 0, 576, 413)));
        assert_eq!(party(1045), Some(r(0, 0, 583, 418)));
        assert_eq!(party(1056), Some(r(0, 0, 589, 422)));
        assert_eq!(party(1080), Some(r(0, 0, 602, 432)));
        // The cheap first area keeps the box T2 pinned.
        let fixed = |height| panel_region(PanelRegion::PartyFixed, 1920, height);
        assert_eq!(fixed(1033), Some(r(230, 100, 250, 170)));
        assert_eq!(fixed(1045), Some(r(233, 101, 253, 172)));
        assert_eq!(fixed(1056), Some(r(235, 102, 256, 174)));
        assert_eq!(fixed(1080), Some(r(240, 105, 261, 178)));
        assert_eq!(life(1033), Some(r(400, 826, 160, 22)));
        assert_eq!(life(1045), Some(r(405, 836, 162, 22)));
        assert_eq!(life(1056), Some(r(409, 844, 164, 22)));
        assert_eq!(life(1080), Some(r(418, 864, 167, 23)));
        assert_eq!(area(1033), Some(r(1750, 52, 150, 16)));
        assert_eq!(area(1045), Some(r(1748, 53, 152, 16)));
        assert_eq!(area(1056), Some(r(1747, 53, 153, 16)));
        assert_eq!(area(1080), Some(r(1742, 54, 157, 17)));
    }
}
