//! The screen reader of the character screens (CHR-04, CHR-06, CHR-18): reads a captured frame through the text port,
//! samples the gold frame of the selected card, and lets the domain decide what the frame shows. The cards and the popup's
//! options are found by the text of the lines read in their search areas, not at fixed offsets (the full-screen incident,
//! 0.1.3: a full-screen client draws the panels at other offsets than a maximized one). The frame and the text never leave
//! the process (AGS-20). A frame in an unsupported client size shows nothing (CHR-19).

use std::sync::Arc;

use d2rmm_agent_domain::anchors::{self, line_pad};
use d2rmm_agent_domain::character_screen::{
    is_enabled_label, is_gold, label_brightness, luma, read_screen,
};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region, selection_band, supported_size};
use d2rmm_agent_domain::presence::Screen;
use d2rmm_agent_domain::vision::{Region, TextLine};

use crate::messages::FrameReading;
use crate::ports::{FrameReader, Rgba, TextReader};

/// Reads the character screens of a frame: the markers, the popup and the cards, with the language pack's words.
pub struct ScreenReader {
    reader: Arc<dyn TextReader + Send + Sync>,
    language: Arc<LanguagePack>,
}

/// What the anchors found in a frame: counts only, never a line of text (`ocr-check` prints them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AnchorCounts {
    /// The cards found by their level line in the character list's column.
    pub cards: usize,
    /// The popup options found by their word (0 to 3).
    pub popup_options: usize,
}

impl ScreenReader {
    pub fn new(reader: Arc<dyn TextReader + Send + Sync>, language: Arc<LanguagePack>) -> Self {
        Self { reader, language }
    }

    /// The lines of a search area as each variant of the reader reads them.
    fn lines_of(&self, frame: &Rgba, search: ScreenRegion) -> Vec<Vec<TextLine>> {
        screen_region(search, frame.width, frame.height)
            .map(|area| self.reader.read_line_variants(frame, area))
            .unwrap_or_default()
    }

    /// How many cards and popup options the anchors find in a frame. Reads the two search areas once each.
    pub fn anchor_counts(&self, frame: &Rgba) -> AnchorCounts {
        if !supported_size(frame.width, frame.height) {
            return AnchorCounts::default();
        }
        AnchorCounts {
            cards: anchors::find_cards_in_variants(
                &self.language,
                &self.lines_of(frame, ScreenRegion::CardColumn),
                frame.height,
            )
            .len(),
            popup_options: anchors::popup_options_in_variants(
                &self.language,
                &self.lines_of(frame, ScreenRegion::PopupArea),
            )
            .len(),
        }
    }
}

/// Every reading of a region, the lines of each joined with a space.
pub fn readings_of(reader: &dyn TextReader, frame: &Rgba, area: Region) -> Vec<String> {
    reader
        .read_variants(frame, area)
        .into_iter()
        .map(|read| {
            read.text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

impl FrameReader for ScreenReader {
    fn read(&self, frame: &Rgba) -> FrameReading {
        if !supported_size(frame.width, frame.height) {
            return FrameReading::without_cards(Screen::Unknown);
        }
        let text = |region: ScreenRegion| -> Option<Vec<String>> {
            let area = screen_region(region, frame.width, frame.height)?;
            let readings = readings_of(self.reader.as_ref(), frame, area);
            (!readings.is_empty()).then_some(readings)
        };
        // A found line is read again, once per variant: its box grown by a few pixels, so the strokes of the glyphs are in.
        let field = |region: Region| -> Option<Vec<String>> {
            let area = anchors::padded(region, line_pad(frame.height), frame.width, frame.height);
            let readings = readings_of(self.reader.as_ref(), frame, area);
            (!readings.is_empty()).then_some(readings)
        };
        let reading = read_screen(
            &self.language,
            frame.height,
            text,
            |search| self.lines_of(frame, search),
            field,
            |name| is_selected(frame, name),
            |region| is_lit(frame, region),
        );
        FrameReading {
            screen: reading.screen,
            cards: reading.cards,
            slots_read: reading.slots_read,
            popup_options: reading.popup_options,
            rejected: reading.rejected,
        }
    }
}

/// Whether the card whose name line is `name` shows the gold frame: any pixel of the band above its name (`selection_band`)
/// is gold.
fn is_selected(frame: &Rgba, name: Region) -> bool {
    let Some(area) = selection_band(name, frame.width, frame.height) else {
        return false;
    };
    (area.y..area.y + area.height).any(|y| {
        (area.x..area.x + area.width)
            .any(|x| pixel(frame, x, y).is_some_and(|[red, green, blue]| is_gold(red, green, blue)))
    })
}

/// Whether a popup option is as bright as an enabled one: the brightness of the pixels of its line (`label_brightness`)
/// reaches an enabled label's (CHR-18). An option outside the frame is not lit.
fn is_lit(frame: &Rgba, area: Region) -> bool {
    let lumas: Vec<u8> = (area.y..area.y.saturating_add(area.height))
        .flat_map(|y| (area.x..area.x.saturating_add(area.width)).map(move |x| (x, y)))
        .filter_map(|(x, y)| pixel(frame, x, y).map(|[red, green, blue]| luma(red, green, blue)))
        .collect();
    label_brightness(lumas).is_some_and(is_enabled_label)
}

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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::characters::{Class, Difficulty, Mode, Title};
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{ScreenRegion, screen_region, screen_text_regions};
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};
    use serde_json::Value;

    use super::{AnchorCounts, ScreenReader};
    use crate::messages::FrameReading;
    use crate::ports::{FrameReader, ReadError, Rgba, TextReader};

    /// The sidecars of the drawn fixtures (`apps/agent/fixtures/characters`): the text each region shows, with the boxes of
    /// the maximized 1920×1033 layout scaled to the frame.
    const SELECT_NORMAL: &str = include_str!("../../../fixtures/characters/select-normal.png.json");
    const SELECT_TITLES: &str = include_str!("../../../fixtures/characters/select-titles.png.json");
    const SELECT_FULL: &str = include_str!("../../../fixtures/characters/select-full.png.json");
    const SELECT_DIFFICULTY: &str =
        include_str!("../../../fixtures/characters/select-difficulty.png.json");
    const SELECT_DIFFICULTY_DIMMED: &str =
        include_str!("../../../fixtures/characters/select-difficulty-dimmed.png.json");
    const IN_GAME: &str = include_str!("../../../fixtures/characters/in-game.png.json");
    const AUTOMAP: &str = include_str!("../../../fixtures/characters/automap.png.json");
    const MENU: &str = include_str!("../../../fixtures/characters/menu.png.json");
    /// The sidecars of the full-screen fixtures (`apps/agent/fixtures/fullscreen`): the lines of a 1920×1080 full-screen
    /// client, each with its own box, measured on the maintainer's prints.
    const FULLSCREEN_SELECT: &str = include_str!("../../../fixtures/fullscreen/select.png.json");
    const FULLSCREEN_DIFFICULTY: &str =
        include_str!("../../../fixtures/fullscreen/difficulty.png.json");

    /// A sidecar as a reader: the marker regions answer their text; the other text is lines, found in a search area and read
    /// again where a line sits.
    struct Sidecar {
        markers: Vec<(Region, String)>,
        lines: Vec<TextLine>,
        gold: Option<Region>,
        size: (u32, u32),
        asked_areas: Mutex<Vec<Region>>,
    }

    fn region_of(value: &Value) -> Region {
        let get = |key: &str| value[key].as_u64().expect("a number") as u32;
        Region {
            x: get("x"),
            y: get("y"),
            width: get("width"),
            height: get("height"),
        }
    }

    impl Sidecar {
        /// A sidecar read at a frame of this size. A sidecar with `lines` gives its lines their own boxes; the others give
        /// every card field and popup label the box of the layout's region.
        fn of(json: &str, width: u32, height: u32) -> Self {
            let value: Value = serde_json::from_str(json).expect("the sidecar is JSON");
            let object = value.as_object().expect("the sidecar is an object");
            let markers = [
                ScreenRegion::CreateNew,
                ScreenRegion::Life,
                ScreenRegion::AreaDifficulty,
            ]
            .into_iter()
            .filter_map(|region| {
                let text = object.get(&region.key())?.as_str()?;
                Some((screen_region(region, width, height)?, text.to_string()))
            })
            .collect();
            let mut lines: Vec<TextLine> = object
                .get("lines")
                .and_then(Value::as_array)
                .map(|lines| {
                    lines
                        .iter()
                        .map(|line| TextLine {
                            text: line["text"].as_str().expect("a text").to_string(),
                            region: region_of(line),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let drawn_in_layout = [
                ScreenRegion::SelectDifficulty,
                ScreenRegion::PopupNormal,
                ScreenRegion::PopupNightmare,
                ScreenRegion::PopupHell,
            ]
            .into_iter()
            .chain(screen_text_regions().into_iter().filter(|region| {
                matches!(
                    region,
                    ScreenRegion::CardTitle(_)
                        | ScreenRegion::CardName(_)
                        | ScreenRegion::CardLevel(_)
                )
            }));
            for region in drawn_in_layout {
                let Some(text) = object.get(&region.key()).and_then(Value::as_str) else {
                    continue;
                };
                if let (false, Some(area)) =
                    (text.trim().is_empty(), screen_region(region, width, height))
                {
                    lines.push(TextLine {
                        text: text.to_string(),
                        region: area,
                    });
                }
            }
            Self {
                markers,
                lines,
                gold: object.get("gold").map(region_of),
                size: (width, height),
                asked_areas: Mutex::new(Vec::new()),
            }
        }

        fn inside(area: Region, line: &TextLine) -> bool {
            let (x, y) = (line.region.middle_x(), line.region.middle_y());
            area.x <= x && x < area.right() && area.y <= y && y < area.bottom()
        }
    }

    impl TextReader for Sidecar {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            if let Some((_, text)) = self.markers.iter().find(|(listed, _)| *listed == region) {
                return Ok(ReadText {
                    text: text.clone(),
                    confidence: 1.0,
                });
            }
            let mut found: Vec<&TextLine> = self
                .lines
                .iter()
                .filter(|line| Self::inside(region, line))
                .collect();
            found.sort_by_key(|line| line.region.y);
            if found.is_empty() {
                return Err(ReadError::Failed);
            }
            Ok(ReadText {
                text: found
                    .iter()
                    .map(|line| line.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
                confidence: 1.0,
            })
        }

        fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
            self.asked_areas
                .lock()
                .expect("the asked areas")
                .push(region);
            self.lines
                .iter()
                .filter(|line| Self::inside(region, line))
                .cloned()
                .collect()
        }
    }

    /// A frame of the size: grey everywhere, with the gold top border of the selected card painted where the sidecar puts it
    /// (a `gold` box, or the layout's border of the selected slot), and the popup labels painted bright, as an enabled label
    /// is, except the `dimmed` difficulties, painted dark.
    fn frame(sidecar: &Sidecar, selected: Option<u8>, dimmed: &[Difficulty]) -> Rgba {
        let (width, height) = (sidecar.size.0, sidecar.size.1);
        let mut pixels = vec![60_u8; (width * height * 4) as usize];
        let mut paint = |area: Region, colour: [u8; 4]| {
            for y in area.y..area.bottom() {
                for x in area.x..area.right() {
                    let at = ((y * width + x) * 4) as usize;
                    pixels[at..at + 4].copy_from_slice(&colour);
                }
            }
        };
        let pack = LanguagePack::english();
        for line in &sidecar.lines {
            let Some(difficulty) = pack.read_difficulty(&line.text) else {
                continue;
            };
            let level = if dimmed.contains(&difficulty) {
                94
            } else {
                246
            };
            paint(line.region, [level, level, level, 255]);
        }
        if let Some(slot) = selected {
            let area = sidecar.gold.unwrap_or_else(|| {
                screen_region(ScreenRegion::CardSelected(slot), width, height)
                    .expect("the size is supported")
            });
            paint(area, [227, 201, 97, 255]);
        }
        Rgba {
            width,
            height,
            pixels,
        }
    }

    fn read(json: &str, selected: Option<u8>) -> FrameReading {
        read_at(json, 1920, 1080, selected)
    }

    fn read_at(json: &str, width: u32, height: u32, selected: Option<u8>) -> FrameReading {
        read_dimmed_at(json, width, height, selected, &[])
    }

    /// Reads a sidecar's frame with the popup labels of `dimmed` drawn dark: their text still reads (CHR-18).
    fn read_dimmed(json: &str, selected: Option<u8>, dimmed: &[Difficulty]) -> FrameReading {
        read_dimmed_at(json, 1920, 1080, selected, dimmed)
    }

    fn read_dimmed_at(
        json: &str,
        width: u32,
        height: u32,
        selected: Option<u8>,
        dimmed: &[Difficulty],
    ) -> FrameReading {
        let sidecar = Sidecar::of(json, width, height);
        let image = frame(&sidecar, selected, dimmed);
        let reader = ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english()));
        reader.read(&image)
    }

    fn names(reading: &FrameReading) -> Vec<&str> {
        reading.cards.iter().map(|card| card.name()).collect()
    }

    /// The areas the lines were searched in for one frame, and the reading.
    fn asked_for(json: &str) -> (FrameReading, Vec<Region>) {
        let sidecar = Arc::new(Sidecar::of(json, 1920, 1080));
        let image = frame(&sidecar, None, &[]);
        let reader = ScreenReader::new(
            Arc::clone(&sidecar) as Arc<dyn TextReader + Send + Sync>,
            Arc::new(LanguagePack::english()),
        );
        let reading = reader.read(&image);
        let asked = sidecar.asked_areas.lock().expect("the asked areas").clone();
        (reading, asked)
    }

    #[test]
    fn the_card_column_is_searched_only_on_the_selection_screen() {
        let column = screen_region(ScreenRegion::CardColumn, 1920, 1080).expect("resolves");
        for json in [IN_GAME, AUTOMAP, MENU] {
            let (reading, asked) = asked_for(json);
            assert!(reading.cards.is_empty());
            assert!(
                !asked.contains(&column),
                "a frame that is not the selection screen reads no card"
            );
        }
        let (reading, asked) = asked_for(SELECT_NORMAL);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert!(
            asked.contains(&column),
            "the selection screen reads its cards"
        );
    }

    #[test]
    fn a_dimmed_difficulty_label_enables_nothing_even_when_its_text_reads() {
        // The sidecar reads Nightmare and Hell as text; the frame draws them dark, so only Normal is enabled (CHR-18).
        let reading = read_dimmed(
            SELECT_DIFFICULTY_DIMMED,
            Some(0),
            &[Difficulty::Nightmare, Difficulty::Hell],
        );
        let matriarch = reading.cards.first().expect("vukVuka is listed");
        assert_eq!(matriarch.name(), "vukVuka");
        assert_eq!(
            matriarch.unlocked_difficulties(),
            vec![Difficulty::Normal],
            "the popup's enabled difficulties are Normal alone"
        );
    }

    #[test]
    fn the_same_popup_with_every_label_bright_enables_all_three() {
        let reading = read_dimmed(SELECT_DIFFICULTY_DIMMED, Some(0), &[]);
        let matriarch = reading.cards.first().expect("vukVuka is listed");
        assert_eq!(
            matriarch.unlocked_difficulties().len(),
            3,
            "the popup's three labels are bright"
        );
    }

    #[test]
    fn the_selection_screen_registers_both_cards_with_their_fields() {
        let reading = read(SELECT_NORMAL, Some(0));
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        let matriarch = &reading.cards[0];
        assert_eq!(matriarch.class(), Class::Sorceress);
        assert_eq!(matriarch.level(), 88);
        assert_eq!(matriarch.title(), Some(Title::Matriarch));
        assert_eq!(matriarch.mode(), Mode::Softcore);
        assert_eq!(
            reading.cards[1].title(),
            None,
            "the untitled card has no title"
        );
    }

    #[test]
    fn a_hardcore_title_registers_a_hardcore_card() {
        let reading = read(SELECT_TITLES, Some(0));
        let ember = reading
            .cards
            .iter()
            .find(|card| card.name() == "Ember")
            .expect("Ember is listed");
        assert_eq!(ember.mode(), Mode::Hardcore);
        assert_eq!(ember.class(), Class::Barbarian);
        assert_eq!(ember.level(), 45);
    }

    #[test]
    fn a_full_list_registers_every_card_of_the_fixture() {
        let reading = read(SELECT_FULL, Some(0));
        assert_eq!(
            names(&reading),
            [
                "Aldric", "Morrow", "Vexa", "Tharn", "Kessa", "Orrin", "Liora", "Dresk", "Nyx"
            ]
        );
    }

    #[test]
    fn a_card_whose_level_cannot_be_read_is_not_registered() {
        let without_level = SELECT_FULL.replace("\"cardLevel5\": \"Level 99 Barbarian\",", "");
        let reading = read(&without_level, Some(0));
        assert_eq!(reading.cards.len(), 8, "the other eight are kept");
        assert!(
            !names(&reading).contains(&"Orrin"),
            "Orrin's level was unreadable"
        );
    }

    #[test]
    fn the_popup_gives_the_difficulties_to_the_card_with_the_gold_frame() {
        let reading = read(SELECT_DIFFICULTY, Some(2));
        let ember = reading
            .cards
            .iter()
            .find(|card| card.name() == "Ember")
            .expect("Ember is listed");
        assert_eq!(
            ember.unlocked_difficulties(),
            vec![Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell],
            "the popup's three, not the Countess title's two"
        );
    }

    #[test]
    fn the_reading_counts_the_popup_options_found_and_none_without_a_popup() {
        assert_eq!(read(SELECT_DIFFICULTY, None).popup_options, 3);
        assert_eq!(read(SELECT_NORMAL, None).popup_options, 0);
    }

    #[test]
    fn a_popup_without_a_gold_card_leaves_every_card_to_its_title() {
        let reading = read(SELECT_DIFFICULTY, None);
        let ember = reading
            .cards
            .iter()
            .find(|card| card.name() == "Ember")
            .expect("Ember is listed");
        assert_eq!(
            ember.unlocked_difficulties().len(),
            2,
            "the Countess title's two"
        );
    }

    #[test]
    fn the_in_game_automap_and_menu_frames_read_their_screens() {
        assert_eq!(read(IN_GAME, None).screen, Screen::InGame);
        assert_eq!(read(AUTOMAP, None).screen, Screen::AutomapOpen);
        assert_eq!(read(MENU, None).screen, Screen::Unknown);
        assert!(read(MENU, None).cards.is_empty());
    }

    #[test]
    fn a_size_outside_the_supported_range_reads_nothing() {
        let reading = read_at(SELECT_NORMAL, 1280, 1024, None);
        assert_eq!(reading.screen, Screen::Unknown);
        assert!(reading.cards.is_empty());
    }

    #[test]
    fn the_maintainer_client_of_1920_by_1033_reads_the_same_cards() {
        let reading = read_at(SELECT_NORMAL, 1920, 1033, Some(0));
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        assert_eq!(reading.cards[0].title(), Some(Title::Matriarch));
        assert_eq!(reading.cards[1].title(), None);
    }

    #[test]
    fn a_frame_with_no_text_reads_unknown() {
        struct Blank;
        impl TextReader for Blank {
            fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
                Err(ReadError::EngineUnavailable)
            }
        }
        let reader = ScreenReader::new(Arc::new(Blank), Arc::new(LanguagePack::english()));
        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: vec![60; 1920 * 1080 * 4],
        };
        assert_eq!(reader.read(&image).screen, Screen::Unknown);
        assert_eq!(reader.anchor_counts(&image), AnchorCounts::default());
    }

    // The full-screen 1920×1080 client of the maintainer's prints (0.1.3): the same screens at other offsets.

    #[test]
    fn the_full_screen_list_reads_the_titled_and_the_untitled_card() {
        let reading = read(FULLSCREEN_SELECT, Some(0));
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        let matriarch = &reading.cards[0];
        assert_eq!(matriarch.title(), Some(Title::Matriarch));
        assert_eq!(matriarch.class(), Class::Sorceress);
        assert_eq!(matriarch.level(), 88);
        assert_eq!(
            reading.cards[1].title(),
            None,
            "the tab above the first card is not a title; the second card has none"
        );
        assert_eq!(reading.cards[1].level(), 11);
        assert_eq!(reading.slots_read, 2);
        assert!(reading.rejected.is_empty());
    }

    #[test]
    fn the_full_screen_popup_gives_its_difficulties_to_the_card_with_the_gold_frame() {
        let reading = read(FULLSCREEN_DIFFICULTY, Some(0));
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell]
        );
        assert_eq!(
            reading.cards[1].unlocked_difficulties(),
            vec![Difficulty::Normal]
        );
        let dimmed = read_dimmed(
            FULLSCREEN_DIFFICULTY,
            Some(0),
            &[Difficulty::Nightmare, Difficulty::Hell],
        );
        assert_eq!(
            dimmed.cards[0].unlocked_difficulties(),
            vec![Difficulty::Normal],
            "the popup options are lit by the pixels of their own lines"
        );
    }

    #[test]
    fn without_a_gold_frame_the_dimmed_popup_applies_to_no_card() {
        let sidecar = Sidecar::of(FULLSCREEN_DIFFICULTY, 1920, 1080);
        let image = frame(&sidecar, None, &[Difficulty::Nightmare, Difficulty::Hell]);
        let reader = ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english()));
        let reading = reader.read(&image);
        assert_eq!(
            reading.cards[0].unlocked_difficulties(),
            vec![Difficulty::Normal, Difficulty::Nightmare, Difficulty::Hell],
            "no gold frame: the Matriarch title's three stand"
        );
    }

    #[test]
    fn the_anchors_found_are_counted_without_their_text() {
        let counts = |json: &str, width, height| {
            let sidecar = Sidecar::of(json, width, height);
            let image = frame(&sidecar, None, &[]);
            ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english()))
                .anchor_counts(&image)
        };
        assert_eq!(
            counts(FULLSCREEN_SELECT, 1920, 1080),
            AnchorCounts {
                cards: 2,
                popup_options: 0
            }
        );
        assert_eq!(
            counts(FULLSCREEN_DIFFICULTY, 1920, 1080),
            AnchorCounts {
                cards: 2,
                popup_options: 3
            }
        );
        assert_eq!(
            counts(SELECT_DIFFICULTY, 1920, 1033),
            AnchorCounts {
                cards: 3,
                popup_options: 3
            }
        );
        assert_eq!(counts(MENU, 1920, 1080), AnchorCounts::default());
        assert_eq!(counts(SELECT_NORMAL, 1280, 1024), AnchorCounts::default());
    }
}
