//! The screen reader of the character screens (CHR-04, CHR-06, CHR-18): reads a captured frame through the text port one
//! region at a time, samples the gold frame of each card, and lets the domain decide what the frame shows. The frame and
//! the text never leave the process (AGS-20). A frame in an unsupported client size shows nothing (CHR-19).

use std::sync::Arc;

use d2rmm_agent_domain::character_screen::{is_gold, read_screen};
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
            return FrameReading {
                screen: Screen::Unknown,
                cards: Vec::new(),
            };
        }
        let text = |region: ScreenRegion| -> Option<String> {
            let area = screen_region(region, frame.width, frame.height)?;
            let read = self.reader.read(frame, area).ok()?;
            Some(
                read.text
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join(" "),
            )
        };
        let reading = read_screen(&self.language, text, |slot| is_selected(frame, slot));
        FrameReading {
            screen: reading.screen,
            cards: reading.cards,
        }
    }
}

/// Whether a card slot shows the gold frame of the selected card: any pixel of its sampled top border is gold.
fn is_selected(frame: &Rgba, slot: u8) -> bool {
    let Some(area) = screen_region(ScreenRegion::CardSelected(slot), frame.width, frame.height)
    else {
        return false;
    };
    (area.y..area.y + area.height)
        .any(|y| (area.x..area.x + area.width).any(|x| pixel_is_gold(frame, x, y)))
}

fn pixel_is_gold(frame: &Rgba, x: u32, y: u32) -> bool {
    let at = (y as usize * frame.width as usize + x as usize) * 4;
    match frame.pixels.get(at..at + 3) {
        Some(&[red, green, blue]) => is_gold(red, green, blue),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use d2rmm_agent_domain::characters::{Class, Mode, Title};
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{ScreenRegion, screen_region, screen_text_regions};
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

    /// A frame of the size: grey everywhere, with the top border of the selected card drawn gold, as the fixtures are.
    fn frame(width: u32, height: u32, selected: Option<u8>) -> Rgba {
        let mut pixels = vec![60_u8; (width * height * 4) as usize];
        if let Some(slot) = selected {
            let area = screen_region(ScreenRegion::CardSelected(slot), width, height)
                .expect("the size is supported");
            for y in area.y..area.y + area.height {
                for x in area.x..area.x + area.width {
                    let at = ((y * width + x) * 4) as usize;
                    pixels[at..at + 4].copy_from_slice(&[227, 201, 97, 255]);
                }
            }
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
        let reader = ScreenReader::new(
            Arc::new(Sidecar::of(json, width, height)),
            Arc::new(LanguagePack::english()),
        );
        reader.read(&frame(width, height, selected))
    }

    fn names(reading: &FrameReading) -> Vec<&str> {
        reading.cards.iter().map(|card| card.name()).collect()
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
        let reading = reader.read(&frame(1920, 1080, None));
        assert_eq!(reading.screen, Screen::Unknown);
    }
}
