//! The screen reader of the character screens (CHR-04, CHR-06, CHR-18): reads a captured frame through the text port one
//! region at a time, samples the gold frame of each card, and lets the domain decide what the frame shows. The frame and
//! the text never leave the process (AGS-20). A frame in an unsupported client size shows nothing (CHR-19).

use std::sync::Arc;

use d2rmm_agent_domain::character_screen::{
    is_enabled_label, is_gold, label_brightness, luma, read_screen,
};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region, supported_size};
use d2rmm_agent_domain::presence::Screen;

use crate::messages::FrameReading;
use crate::ports::{FrameReader, Rgba, TextReader};

/// Reads the character screens of a frame: the markers, the popup and the cards, with the language pack's words.
pub struct ScreenReader {
    reader: Arc<dyn TextReader + Send + Sync>,
    language: Arc<LanguagePack>,
}

impl ScreenReader {
    pub fn new(reader: Arc<dyn TextReader + Send + Sync>, language: Arc<LanguagePack>) -> Self {
        Self { reader, language }
    }
}

impl FrameReader for ScreenReader {
    fn read(&self, frame: &Rgba) -> FrameReading {
        if !supported_size(frame.width, frame.height) {
            return FrameReading::without_cards(Screen::Unknown);
        }
        let text = |region: ScreenRegion| -> Option<Vec<String>> {
            let area = screen_region(region, frame.width, frame.height)?;
            let readings: Vec<String> = self
                .reader
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
                .collect();
            (!readings.is_empty()).then_some(readings)
        };
        let reading = read_screen(
            &self.language,
            text,
            |slot| is_selected(frame, slot),
            |region| is_lit(frame, region),
        );
        FrameReading {
            screen: reading.screen,
            cards: reading.cards,
            slots_read: reading.slots_read,
            rejected: reading.rejected,
        }
    }
}

/// Whether a card slot shows the gold frame of the selected card: any pixel of its sampled top border is gold.
fn is_selected(frame: &Rgba, slot: u8) -> bool {
    let Some(area) = screen_region(ScreenRegion::CardSelected(slot), frame.width, frame.height)
    else {
        return false;
    };
    (area.y..area.y + area.height).any(|y| {
        (area.x..area.x + area.width)
            .any(|x| pixel(frame, x, y).is_some_and(|[red, green, blue]| is_gold(red, green, blue)))
    })
}

/// Whether a popup label is as bright as an enabled one: the brightness of its pixels (`label_brightness`) reaches an
/// enabled label's (CHR-18). A label outside the frame is not lit.
fn is_lit(frame: &Rgba, region: ScreenRegion) -> bool {
    let Some(area) = screen_region(region, frame.width, frame.height) else {
        return false;
    };
    let lumas: Vec<u8> = (area.y..area.y + area.height)
        .flat_map(|y| (area.x..area.x + area.width).map(move |x| (x, y)))
        .filter_map(|(x, y)| pixel(frame, x, y).map(|[red, green, blue]| luma(red, green, blue)))
        .collect();
    label_brightness(lumas).is_some_and(is_enabled_label)
}

/// The red, green and blue of the pixel at `x`, `y`, or `None` outside the frame.
fn pixel(frame: &Rgba, x: u32, y: u32) -> Option<[u8; 3]> {
    let at = (y as usize * frame.width as usize + x as usize) * 4;
    match frame.pixels.get(at..at + 3) {
        Some(&[red, green, blue]) => Some([red, green, blue]),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use d2rmm_agent_domain::characters::{Class, Mode, Title};
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{
        CARD_SLOTS, ScreenRegion, screen_region, screen_text_regions,
    };
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::vision::{ReadText, Region};
    use serde_json::Value;

    use super::ScreenReader;
    use crate::messages::FrameReading;
    use crate::ports::{FrameReader, ReadError, Rgba, TextReader};

    /// The sidecars of the drawn fixtures (`apps/agent/fixtures/characters`): the text each region shows.
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

    /// The text of each region a sidecar names, read at the regions of a frame of this size.
    struct Sidecar {
        texts: Vec<(Region, String)>,
    }

    impl Sidecar {
        fn of(json: &str, width: u32, height: u32) -> Self {
            let value: Value = serde_json::from_str(json).expect("the sidecar is JSON");
            let object = value.as_object().expect("the sidecar is an object");
            let texts = screen_text_regions()
                .into_iter()
                .filter_map(|region| {
                    let text = object.get(&region.key())?.as_str()?;
                    Some((screen_region(region, width, height)?, text.to_string()))
                })
                .collect();
            Self { texts }
        }
    }

    impl TextReader for Sidecar {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.texts
                .iter()
                .find(|(listed, _)| *listed == region)
                .map(|(_, text)| ReadText {
                    text: text.clone(),
                    confidence: 1.0,
                })
                .ok_or(ReadError::Failed)
        }
    }

    /// A frame of the size: grey everywhere, with the top border of the selected card drawn gold, as the fixtures are. The
    /// popup labels are drawn bright, as an enabled label is, except the `dimmed` ones, drawn dark.
    fn frame(width: u32, height: u32, selected: Option<u8>, dimmed: &[ScreenRegion]) -> Rgba {
        let mut pixels = vec![60_u8; (width * height * 4) as usize];
        let mut paint = |area: Region, colour: [u8; 4]| {
            for y in area.y..area.y + area.height {
                for x in area.x..area.x + area.width {
                    let at = ((y * width + x) * 4) as usize;
                    pixels[at..at + 4].copy_from_slice(&colour);
                }
            }
        };
        for label in [
            ScreenRegion::PopupNormal,
            ScreenRegion::PopupNightmare,
            ScreenRegion::PopupHell,
        ] {
            // A size the reader does not support has no regions to paint.
            let Some(area) = screen_region(label, width, height) else {
                continue;
            };
            let level = if dimmed.contains(&label) { 94 } else { 246 };
            paint(area, [level, level, level, 255]);
        }
        if let Some(slot) = selected {
            let area = screen_region(ScreenRegion::CardSelected(slot), width, height)
                .expect("the size is supported");
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

    /// Reads a sidecar's frame with the popup labels in `dimmed` drawn dark: their text still reads (CHR-18).
    fn read_dimmed(json: &str, selected: Option<u8>, dimmed: &[ScreenRegion]) -> FrameReading {
        read_dimmed_at(json, 1920, 1080, selected, dimmed)
    }

    fn read_dimmed_at(
        json: &str,
        width: u32,
        height: u32,
        selected: Option<u8>,
        dimmed: &[ScreenRegion],
    ) -> FrameReading {
        let reader = ScreenReader::new(
            Arc::new(Sidecar::of(json, width, height)),
            Arc::new(LanguagePack::english()),
        );
        reader.read(&frame(width, height, selected, dimmed))
    }

    fn names(reading: &FrameReading) -> Vec<&str> {
        reading.cards.iter().map(|card| card.name()).collect()
    }

    /// A sidecar reader that also records every region it is asked for (T8: the loop's OCR cost).
    struct Recording {
        inner: Sidecar,
        asked: std::sync::Mutex<Vec<Region>>,
    }

    impl TextReader for Recording {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.asked.lock().expect("the asked list").push(region);
            self.inner.read(image, region)
        }
    }

    /// The regions a frame's text was read at, and the reading.
    fn asked_for(json: &str) -> (FrameReading, Vec<Region>) {
        let recording = Arc::new(Recording {
            inner: Sidecar::of(json, 1920, 1080),
            asked: std::sync::Mutex::new(Vec::new()),
        });
        let reader = ScreenReader::new(
            Arc::clone(&recording) as Arc<dyn TextReader + Send + Sync>,
            Arc::new(LanguagePack::english()),
        );
        let reading = reader.read(&frame(1920, 1080, None, &[]));
        let asked = recording.asked.lock().expect("the asked list").clone();
        (reading, asked)
    }

    /// Every card region of a 1920×1080 frame: the title, name, level and gold border of each slot.
    fn card_regions() -> Vec<Region> {
        (0..CARD_SLOTS)
            .flat_map(|slot| {
                [
                    ScreenRegion::CardTitle(slot),
                    ScreenRegion::CardName(slot),
                    ScreenRegion::CardLevel(slot),
                    ScreenRegion::CardSelected(slot),
                ]
            })
            .filter_map(|region| screen_region(region, 1920, 1080))
            .collect()
    }

    #[test]
    fn the_card_regions_are_read_only_on_the_selection_screen() {
        let cards = card_regions();
        for json in [IN_GAME, AUTOMAP, MENU] {
            let (reading, asked) = asked_for(json);
            assert!(reading.cards.is_empty());
            assert!(
                asked.iter().all(|region| !cards.contains(region)),
                "a frame that is not the selection screen reads no card region"
            );
        }
        let (reading, asked) = asked_for(SELECT_NORMAL);
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert!(
            asked.iter().any(|region| cards.contains(region)),
            "the selection screen reads its cards"
        );
    }

    #[test]
    fn a_dimmed_difficulty_label_enables_nothing_even_when_its_text_reads() {
        // The sidecar reads Nightmare and Hell as text; the frame draws them dark, so only Normal is enabled (CHR-18).
        let reading = read_dimmed(
            SELECT_DIFFICULTY_DIMMED,
            Some(0),
            &[ScreenRegion::PopupNightmare, ScreenRegion::PopupHell],
        );
        let matriarch = reading.cards.first().expect("vukVuka is listed");
        assert_eq!(matriarch.name(), "vukVuka");
        assert_eq!(
            matriarch.unlocked_difficulties(),
            vec![d2rmm_agent_domain::characters::Difficulty::Normal],
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
            vec![
                d2rmm_agent_domain::characters::Difficulty::Normal,
                d2rmm_agent_domain::characters::Difficulty::Nightmare,
                d2rmm_agent_domain::characters::Difficulty::Hell,
            ],
            "the popup's three, not the Countess title's two"
        );
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
        let reading = reader.read(&frame(1920, 1080, None, &[]));
        assert_eq!(reading.screen, Screen::Unknown);
    }
}
