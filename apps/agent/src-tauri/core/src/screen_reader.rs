//! The screen reader of the character screens (CHR-04, CHR-06, CHR-18): reads a captured frame through the text port,
//! samples the gold frame of the selected card, and lets the domain decide what the frame shows. The cards and the popup's
//! options are found by the text of the lines read in their search areas, not at fixed offsets (the full-screen incident,
//! 0.1.3: a full-screen client draws the panels at other offsets than a maximized one). The frame and the text never leave
//! the process (AGS-20). A frame in an unsupported client size shows nothing (CHR-19).

use std::cell::Cell;
use std::sync::{Arc, Mutex, PoisonError};

use d2rmm_agent_domain::anchors::{self, line_pad};
use d2rmm_agent_domain::character_screen::{
    BandRead, Probes, is_enabled_label, is_gold, label_brightness, luma, read_screen,
};
use d2rmm_agent_domain::hud_track::{AUTOMAP_SEARCH_EVERY, LIST_SEARCH_EVERY, TrackRead, Tracker};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{
    ScreenRegion, screen_region, screen_region_with, selection_band, supported_size,
};
use d2rmm_agent_domain::presence::Screen;
use d2rmm_agent_domain::remote_config::Effective;
use d2rmm_agent_domain::vision::{Region, TextLine};

use crate::messages::FrameReading;
use crate::ports::{FrameReader, Rgba, TextReader};
use crate::title_ink::{InkRead, read_band};

/// Reads the character screens of a frame: the markers, the popup and the cards, with the language pack's words.
pub struct ScreenReader {
    reader: Arc<dyn TextReader + Send + Sync>,
    language: Arc<LanguagePack>,
    /// Where the HUD's label was last found: the next frames read a small box around it, not the whole band.
    hud: Mutex<Tracker>,
    /// The same for the automap's "Difficulty:" line.
    automap: Mutex<Tracker>,
    /// The same for the character list's "Create New" button, searched only when the fixed box missed.
    create_new: Mutex<Tracker>,
}

/// How a frame's HUD, automap or list marker was looked for (SCR-09): the tracked box held it, the wide area was searched,
/// or the search rested for the frame. The last tracker asked sets it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Search {
    Track,
    Band,
    Rested,
}

/// The fixed words a frame's reading carries on its `agent.vision.read` span (`vision.screen`, `vision.search`,
/// `vision.area_class`): never a coordinate, a text or a pixel.
fn vision_words(screen: Screen, search: Option<Search>) -> [&'static str; 3] {
    let screen_word = match screen {
        Screen::InGame => "in_game",
        Screen::AutomapOpen => "automap",
        Screen::CharacterSelect => "character_select",
        Screen::Unknown => "unknown",
    };
    let (search_word, area_class) = match (search, screen) {
        (Some(Search::Track), _) => ("track", "box"),
        (Some(Search::Band), _) => ("band", "band"),
        (Some(Search::Rested), Screen::CharacterSelect) => ("rested", "panel"),
        (Some(Search::Rested), _) => ("rested", "box"),
        (None, Screen::Unknown) => ("none", "box"),
        (None, Screen::CharacterSelect) => ("fixed", "panel"),
        (None, _) => ("fixed", "box"),
    };
    [screen_word, search_word, area_class]
}

/// Finds a tracked label's line in a frame's variants.
type FindLabel = fn(&LanguagePack, &[Vec<TextLine>]) -> Option<Region>;

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
        Self {
            reader,
            language,
            hud: Mutex::new(Tracker::new(ScreenRegion::HudBand)),
            automap: Mutex::new(Tracker::searching_every(
                ScreenRegion::AutomapArea,
                AUTOMAP_SEARCH_EVERY,
            )),
            create_new: Mutex::new(Tracker::searching_every(
                ScreenRegion::CreateNewArea,
                LIST_SEARCH_EVERY,
            )),
        }
    }

    /// The lines that hold a label: the box it was last found in, when it is still there, else the whole search area of
    /// its tracker. What was found is remembered for the next frame (search, then track).
    fn tracked_lines(
        &self,
        frame: &Rgba,
        tracker: &Mutex<Tracker>,
        find: FindLabel,
        every: u32,
        how: &Cell<Option<Search>>,
        config: &Effective,
    ) -> Vec<Vec<TextLine>> {
        let plan = {
            let mut held = tracker.lock().unwrap_or_else(PoisonError::into_inner);
            let plan = held.next_with(
                frame.width,
                frame.height,
                config.thresholds.track_pad,
                &config.regions,
            );
            // A search of the wide area that found nothing last time rests for some frames (NFR-03 CPU).
            if matches!(plan, Some(TrackRead::Search(_))) && held.rests(frame.width, frame.height) {
                how.set(Some(Search::Rested));
                return Vec::new();
            }
            plan
        };
        let (area, tracked) = match plan {
            Some(TrackRead::Track(area)) => (area, true),
            Some(TrackRead::Search(area)) => (area, false),
            None => return Vec::new(),
        };
        let mut lines = self.reader.read_line_variants(frame, area);
        let mut found = find(&self.language, &lines);
        how.set(Some(if tracked && found.is_some() {
            Search::Track
        } else {
            Search::Band
        }));
        if tracked && found.is_none() {
            // The label moved or is gone: look in the whole search area.
            let search = tracker
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .search_area_with(frame.width, frame.height, &config.regions);
            if let Some(search) = search {
                lines = self.reader.read_line_variants(frame, search);
                found = find(&self.language, &lines);
            }
        }
        tracker
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .record_every(found, frame.width, frame.height, every);
        lines
    }

    /// The lines of a search area as each variant of the reader reads them.
    fn lines_of(
        &self,
        frame: &Rgba,
        search: ScreenRegion,
        how: &Cell<Option<Search>>,
        config: &Effective,
    ) -> Vec<Vec<TextLine>> {
        match search {
            ScreenRegion::HudBand => {
                return self.tracked_lines(
                    frame,
                    &self.hud,
                    anchors::find_hud_in_variants,
                    1,
                    how,
                    config,
                );
            }
            ScreenRegion::AutomapArea => {
                return self.tracked_lines(
                    frame,
                    &self.automap,
                    anchors::find_automap_in_variants,
                    config.cadence.automap_search_every,
                    how,
                    config,
                );
            }
            ScreenRegion::CreateNewArea => {
                return self.tracked_lines(
                    frame,
                    &self.create_new,
                    anchors::find_create_new_in_variants,
                    config.cadence.list_search_every,
                    how,
                    config,
                );
            }
            _ => {}
        }
        screen_region_with(search, frame.width, frame.height, &config.regions)
            .map(|area| self.reader.read_line_variants(frame, area))
            .unwrap_or_default()
    }

    /// How many cards and popup options the anchors find in a frame. Reads the two search areas once each.
    pub fn anchor_counts(&self, frame: &Rgba) -> AnchorCounts {
        if !supported_size(frame.width, frame.height) {
            return AnchorCounts::default();
        }
        let built_in = Effective::built_in();
        AnchorCounts {
            cards: anchors::find_cards_in_variants(
                &self.language,
                &self.lines_of(frame, ScreenRegion::CardColumn, &Cell::new(None), &built_in),
                frame.height,
            )
            .len(),
            popup_options: anchors::popup_options_in_variants(
                &self.language,
                &self.lines_of(frame, ScreenRegion::PopupArea, &Cell::new(None), &built_in),
            )
            .len(),
        }
    }
}

/// Every OCR variant's reading of the band, each kept as its lines (the title and the tab strip can share a band), the
/// region grown like a title field. `None` when no variant read anything.
fn lines_of_variants(
    reader: &(dyn TextReader + Send + Sync),
    frame: &Rgba,
    band: Region,
) -> Option<Vec<Vec<String>>> {
    let area = anchors::padded(band, line_pad(frame.height), frame.width, frame.height);
    let variants: Vec<Vec<String>> = reader
        .read_variants(frame, area)
        .into_iter()
        .map(|read| {
            read.text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .collect();
    (!variants.is_empty()).then_some(variants)
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
        self.read_with(frame, &Effective::built_in())
    }

    fn read_with(&self, frame: &Rgba, config: &Effective) -> FrameReading {
        if !supported_size(frame.width, frame.height) {
            return FrameReading::without_cards(Screen::Unknown);
        }
        let span = tracing::info_span!(
            "agent.vision.read",
            "vision.screen" = tracing::field::Empty,
            "vision.search" = tracing::field::Empty,
            "vision.area_class" = tracing::field::Empty,
        );
        let _entered = span.enter();
        let how = Cell::new(None);
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
            |search| self.lines_of(frame, search, &how, config),
            field,
            Probes {
                selected: |name| is_selected(frame, name),
                lit: |region| is_lit(frame, region),
                // A title line no variant read: the card is untitled only when the band where it would be holds no ink;
                // with ink, the band is read again like a title field (T13).
                title_ink: |band, name| match read_band(frame, band, name) {
                    InkRead::Ink => {
                        BandRead::Ink(lines_of_variants(self.reader.as_ref(), frame, band))
                    }
                    InkRead::NoInk => BandRead::NoInk,
                    InkRead::Unclear => BandRead::Unclear,
                },
            },
        );
        let [screen_word, search_word, area_class] = vision_words(reading.screen, how.get());
        span.record("vision.screen", screen_word);
        span.record("vision.search", search_word);
        span.record("vision.area_class", area_class);
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

    use d2rmm_agent_domain::character_screen::RejectReason;
    use d2rmm_agent_domain::characters::{Class, Difficulty, Mode, Title};
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{
        ScreenRegion, screen_region, screen_text_regions, selection_band,
    };
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};
    use serde_json::Value;

    use super::{AnchorCounts, ScreenReader, is_lit, is_selected};
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
        /// Lines the lines pass misses but a read of the place finds (the engine reads a title line in one place and not
        /// in another).
        unlisted: Vec<TextLine>,
        /// Whether a region with no line reads blank, once per variant, instead of failing.
        blank_unread: bool,
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
                unlisted: Vec::new(),
                blank_unread: false,
            }
        }

        /// This sidecar without the line of `text` in the lines pass; a read of its place still finds it when `readable`.
        fn without_line(mut self, text: &str, readable: bool) -> Self {
            let at = self
                .lines
                .iter()
                .position(|line| line.text == text)
                .expect("the sidecar has the line");
            let line = self.lines.remove(at);
            if readable {
                self.unlisted.push(line);
            }
            self
        }

        /// This sidecar with the ONLINE / OFFLINE tab line moved to sit `above` px over the first card's name (middle to
        /// middle), where the lines pass of a real frame finds it when it misses the title line.
        fn with_tab_over_the_name(mut self, above: u32) -> Self {
            let name = self
                .lines
                .iter()
                .find(|line| line.text == "vukVuka")
                .expect("the sidecar has the first name")
                .region;
            let tab = self
                .lines
                .iter_mut()
                .find(|line| line.text.starts_with("ONLINE"))
                .expect("the sidecar has the tab line");
            tab.region.y = (name.middle_y() - above).saturating_sub(tab.region.height / 2);
            self
        }

        /// This sidecar reading a blank text, once per variant, where it finds no line (the engine saw nothing) rather than
        /// failing the read.
        fn with_blank_readings(mut self) -> Self {
            self.blank_unread = true;
            self
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
                .chain(self.unlisted.iter())
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

        fn read_variants(&self, image: &Rgba, region: Region) -> Vec<ReadText> {
            match self.read(image, region) {
                Ok(read) => vec![read],
                Err(_) if self.blank_unread => (0..2)
                    .map(|_| ReadText {
                        text: String::new(),
                        confidence: 0.0,
                    })
                    .collect(),
                Err(_) => Vec::new(),
            }
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
        // The lettering of the card names: strokes 2 px wide every 6 px, so that the name line has the contrast the ink test
        // measures the title band against (a flat frame would leave it `Unclear`, and every unseen title refused).
        for line in sidecar.lines.iter().filter(|line| {
            let text = line.text.trim();
            !text.is_empty()
                && text.chars().all(char::is_alphabetic)
                && pack.read_title_word(text).is_none()
                && pack.read_difficulty(text).is_none()
        }) {
            let area = line.region;
            let mut x = area.x + 1;
            while x + 2 <= area.right() {
                paint(
                    Region {
                        x,
                        y: area.y + 2,
                        width: 2,
                        height: area.height.saturating_sub(4),
                    },
                    [230, 230, 230, 255],
                );
                x += 6;
            }
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

    /// The full-screen list with the Matriarch title line missing from the lines pass: `readable` says whether reading its
    /// place finds it, `ink` whether the frame draws something there.
    fn read_without_title_line(readable: bool, ink: bool) -> FrameReading {
        let sidecar =
            Sidecar::of(FULLSCREEN_SELECT, 1920, 1080).without_line("MATRIARCH", readable);
        let mut image = frame(&sidecar, Some(0), &[]);
        if ink {
            // The strokes of a word where the title was: 2 px wide every 6 px, 12 px high.
            for stroke in 0..20 {
                for y in 81..93 {
                    for x in 1612 + stroke * 6..1614 + stroke * 6 {
                        let at = ((y * image.width + x) * 4) as usize;
                        image.pixels[at..at + 3].copy_from_slice(&[230, 230, 230]);
                    }
                }
            }
        }
        ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english())).read(&image)
    }

    #[test]
    fn a_titled_card_whose_title_line_is_missing_but_inked_is_read_again_or_refused() {
        // The band has ink and reading it again finds the title: the card has it.
        let reading = read_without_title_line(true, true);
        assert_eq!(reading.cards[0].title(), Some(Title::Matriarch));
        assert!(reading.rejected.is_empty());
        // The band has ink and it reads as nothing: the card is refused, never read as untitled.
        let reading = read_without_title_line(false, true);
        assert_eq!(names(&reading), ["vukaDao"]);
        assert_eq!(reading.slots_read, 2);
        assert_eq!(reading.rejected.len(), 1);
        assert_eq!(reading.rejected[0].slot, 0);
        assert_eq!(reading.rejected[0].reason, RejectReason::TitleUnread);
    }

    #[test]
    fn an_inked_band_every_variant_reads_blank_refuses_the_card() {
        let sidecar = Sidecar::of(FULLSCREEN_SELECT, 1920, 1080)
            .without_line("MATRIARCH", false)
            .with_blank_readings();
        let mut image = frame(&sidecar, Some(0), &[]);
        for stroke in 0..20 {
            for y in 81..93 {
                for x in 1612 + stroke * 6..1614 + stroke * 6 {
                    let at = ((y * image.width + x) * 4) as usize;
                    image.pixels[at..at + 3].copy_from_slice(&[230, 230, 230]);
                }
            }
        }
        let reading =
            ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english())).read(&image);
        assert_eq!(reading.rejected.len(), 1);
        assert_eq!(reading.rejected[0].slot, 0);
        assert_eq!(reading.rejected[0].reason, RejectReason::TitleUnread);
    }

    #[test]
    fn an_untitled_card_with_a_dark_band_stays_untitled() {
        // No ink where the title would be: the card has no title, as before (and the second card is untitled too).
        let reading = read_without_title_line(false, false);
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        assert_eq!(reading.cards[0].title(), None);
        assert!(reading.rejected.is_empty());
    }

    /// The full-screen list with the Matriarch title line missing from the lines pass and the tab line right over the name,
    /// so the line above the name is the tab (T15): `readable` says whether reading the title's place finds it, `ink`
    /// whether the frame draws something there.
    fn read_under_the_tab(readable: bool, ink: bool) -> FrameReading {
        read_under_the_tab_at(readable, ink, 43)
    }

    fn read_under_the_tab_at(readable: bool, ink: bool, above: u32) -> FrameReading {
        let sidecar = Sidecar::of(FULLSCREEN_SELECT, 1920, 1080)
            .without_line("MATRIARCH", readable)
            .with_tab_over_the_name(above);
        let mut image = frame(&sidecar, Some(0), &[]);
        if ink {
            for stroke in 0..20 {
                for y in 81..93 {
                    for x in 1612 + stroke * 6..1614 + stroke * 6 {
                        let at = ((y * image.width + x) * 4) as usize;
                        image.pixels[at..at + 3].copy_from_slice(&[230, 230, 230]);
                    }
                }
            }
        }
        ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english())).read(&image)
    }

    #[test]
    fn the_top_card_with_the_tab_over_its_name_and_an_inked_readable_band_has_its_title() {
        let reading = read_under_the_tab(true, true);
        assert_eq!(reading.cards[0].title(), Some(Title::Matriarch));
        assert!(reading.rejected.is_empty());
    }

    #[test]
    fn the_top_card_with_the_tab_over_its_name_and_an_inked_unreadable_band_is_refused() {
        let reading = read_under_the_tab(false, true);
        assert_eq!(names(&reading), ["vukaDao"]);
        assert_eq!(reading.rejected.len(), 1);
        assert_eq!(reading.rejected[0].slot, 0);
        assert_eq!(reading.rejected[0].reason, RejectReason::TitleUnread);
    }

    #[test]
    fn the_top_card_with_the_tab_over_its_name_and_a_dark_band_stays_untitled() {
        let reading = read_under_the_tab(false, false);
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        assert_eq!(reading.cards[0].title(), None);
        assert!(reading.rejected.is_empty());
    }

    #[test]
    fn a_tab_line_inside_the_re_read_band_neither_hides_nor_replaces_the_title() {
        // The tab 38 to 42 px over the name falls in the padded band: the band reads as two lines, settled one by one.
        for above in 38..=42 {
            let reading = read_under_the_tab_at(true, true, above);
            assert_eq!(reading.cards[0].title(), Some(Title::Matriarch), "{above}");
            assert!(reading.rejected.is_empty(), "{above}");
            // The tab line alone beside an unread title is explained ink: no title (the tab is not what is refused).
            let reading = read_under_the_tab_at(false, true, above);
            assert_eq!(reading.cards[0].title(), None, "{above}");
        }
    }

    #[test]
    fn a_garbled_line_beside_the_tab_line_in_the_band_refuses_the_card() {
        for above in [38, 42, 43] {
            let mut sidecar = Sidecar::of(FULLSCREEN_SELECT, 1920, 1080)
                .without_line("MATRIARCH", true)
                .with_tab_over_the_name(above);
            sidecar.unlisted[0].text = "q%z".to_string();
            let mut image = frame(&sidecar, Some(0), &[]);
            for stroke in 0..20 {
                for y in 81..93 {
                    for x in 1612 + stroke * 6..1614 + stroke * 6 {
                        let at = ((y * image.width + x) * 4) as usize;
                        image.pixels[at..at + 3].copy_from_slice(&[230, 230, 230]);
                    }
                }
            }
            let reading = ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english()))
                .read(&image);
            assert_eq!(names(&reading), ["vukaDao"], "{above}");
            assert_eq!(
                reading.rejected[0].reason,
                RejectReason::TitleUnread,
                "{above}"
            );
        }
    }

    #[test]
    fn the_top_card_under_the_tab_strip_is_unaffected() {
        // The tab strip sits 65 px over the name, outside its title band: with no title, the first card reads untitled.
        let sidecar = Sidecar::of(FULLSCREEN_SELECT, 1920, 1080).without_line("MATRIARCH", false);
        assert!(
            sidecar
                .lines
                .iter()
                .any(|line| line.text.starts_with("ONLINE"))
        );
        let mut image = frame(&sidecar, Some(0), &[]);
        // The tab strip is drawn bright, as the game draws it.
        for y in 47..59 {
            for x in 1582..1818 {
                let at = ((y * image.width + x) * 4) as usize;
                image.pixels[at..at + 3].copy_from_slice(&[230, 230, 230]);
            }
        }
        let reading =
            ScreenReader::new(Arc::new(sidecar), Arc::new(LanguagePack::english())).read(&image);
        assert_eq!(names(&reading), ["vukVuka", "vukaDao"]);
        assert_eq!(reading.cards[0].title(), None);
        assert!(reading.rejected.is_empty());
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

    #[test]
    fn gold_pixels_right_of_the_selection_band_do_not_select_the_card() {
        let (width, height) = (1920, 1033);
        let name = Region {
            x: 300,
            y: 500,
            width: 200,
            height: 20,
        };
        let band = selection_band(name, width, height).expect("a band on a supported size");
        let mut image = Rgba {
            width,
            height,
            pixels: vec![0; (width * height * 4) as usize],
        };
        for y in band.y..band.y + band.height {
            for x in band.x + band.width..band.x + band.width + 4 {
                let at = ((y * width + x) * 4) as usize;
                image.pixels[at..at + 3].copy_from_slice(&[200, 170, 60]);
            }
        }
        assert!(!is_selected(&image, name));
        let inside = ((band.y * width + band.x) * 4) as usize;
        image.pixels[inside..inside + 3].copy_from_slice(&[200, 170, 60]);
        assert!(is_selected(&image, name));
    }

    #[test]
    fn an_option_past_the_right_edge_is_lit_only_by_pixels_inside_the_frame() {
        let (width, height) = (10, 4);
        let mut image = Rgba {
            width,
            height,
            pixels: vec![40; (width * height * 4) as usize],
        };
        for x in 0..2u32 {
            let at = ((width + x) * 4) as usize;
            image.pixels[at..at + 3].copy_from_slice(&[250, 250, 250]);
        }
        let area = Region {
            x: 8,
            y: 0,
            width: 4,
            height: 1,
        };
        assert!(!is_lit(&image, area));
        let inside = Region { x: 0, ..area };
        assert!(!is_lit(&image, Region { y: 0, ..inside }));
        assert!(is_lit(&image, Region { y: 1, ..inside }));
    }
}

#[cfg(test)]
mod hud_tests {
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::ScreenReader;
    use crate::ports::{FrameReader, ReadError, Rgba, TextReader};

    /// A reader of a HUD: the lines it shows are found when their middle is inside the area asked; every area asked is
    /// recorded. The HUD's lines can be taken away between frames.
    struct Hud {
        lines: Mutex<Vec<TextLine>>,
        asked: Mutex<Vec<Region>>,
    }

    impl Hud {
        fn new(lines: Vec<TextLine>) -> Arc<Self> {
            Arc::new(Self {
                lines: Mutex::new(lines),
                asked: Mutex::new(Vec::new()),
            })
        }

        fn take_asked(&self) -> Vec<Region> {
            std::mem::take(&mut *self.asked.lock().expect("asked"))
        }
    }

    impl TextReader for Hud {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::Failed)
        }

        fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
            self.asked.lock().expect("asked").push(region);
            self.lines
                .lock()
                .expect("lines")
                .iter()
                .filter(|line| {
                    let (x, y) = (line.region.middle_x(), line.region.middle_y());
                    region.x <= x && x < region.right() && region.y <= y && y < region.bottom()
                })
                .cloned()
                .collect()
        }
    }

    fn life(x: u32, y: u32) -> TextLine {
        TextLine {
            text: "Life: 925 / 925".to_string(),
            region: Region {
                x,
                y,
                width: 160,
                height: 22,
            },
        }
    }

    fn frame(width: u32, height: u32) -> Rgba {
        Rgba {
            width,
            height,
            pixels: vec![0; width as usize * height as usize * 4],
        }
    }

    fn reader(hud: &Arc<Hud>) -> ScreenReader {
        ScreenReader::new(
            Arc::clone(hud) as Arc<dyn TextReader + Send + Sync>,
            Arc::new(LanguagePack::english()),
        )
    }

    fn band_reads(asked: &[Region]) -> usize {
        asked.iter().filter(|area| area.width == 1920).count()
    }

    #[test]
    fn the_life_label_is_found_in_the_window_and_in_full_screen() {
        // The two layouts put the label at other places (window 1920×1056, full screen 1920×1080).
        for (width, height, x, y) in [(1920, 1056, 400, 846), (1920, 1080, 436, 880)] {
            let hud = Hud::new(vec![life(x, y)]);
            let reading = reader(&hud).read(&frame(width, height));
            assert_eq!(reading.screen, Screen::InGame, "{width}×{height}");
        }
    }

    fn difficulty(x: u32, y: u32) -> TextLine {
        TextLine {
            text: "Difficulty: Hell".to_string(),
            region: Region {
                x,
                y,
                width: 150,
                height: 18,
            },
        }
    }

    #[test]
    fn the_automap_is_found_by_its_word_where_the_fixed_box_misses_and_then_tracked() {
        // 1920×1056: the line is at the top right but not in the fixed box. The HUD is on screen too: the automap wins.
        let hud = Hud::new(vec![difficulty(1600, 120), life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1056);
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        let first = hud.take_asked();
        assert_eq!(automap_reads(&first), 1, "searched");
        assert_eq!(band_reads(&first), 0, "the band is not read");
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        let second = hud.take_asked();
        assert_eq!(automap_reads(&second), 0, "only tracked");
        assert!(second.iter().any(|area| area.width < 400 && area.x > 1400));
    }

    #[test]
    fn a_closed_automap_searches_its_area_again_and_reads_the_hud() {
        let hud = Hud::new(vec![difficulty(1600, 120), life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        *hud.lines.lock().expect("lines") = vec![life(436, 880)];
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        hud.take_asked();
        // The search that found nothing rests one frame (NFR-03 CPU), then the area is read again.
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        assert_eq!(automap_reads(&hud.take_asked()), 0, "the search rests");
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        assert_eq!(automap_reads(&hud.take_asked()), 1);
    }

    /// The reads of the whole automap area (about 560 px wide on the reference client, at the top), not of a box around a
    /// line.
    fn automap_reads(asked: &[Region]) -> usize {
        asked
            .iter()
            .filter(|area| (500..1000).contains(&area.width) && area.y < 400)
            .count()
    }

    /// The reads of the whole area the character list's "Create New" button is searched in (about 560 px wide, at the
    /// bottom right).
    fn marker_area_reads(asked: &[Region]) -> usize {
        asked
            .iter()
            .filter(|area| (500..1000).contains(&area.width) && area.y > 700)
            .count()
    }

    fn create_new(x: u32, y: u32) -> TextLine {
        TextLine {
            text: "Create New".to_string(),
            region: Region {
                x,
                y,
                width: 140,
                height: 22,
            },
        }
    }

    #[test]
    fn the_list_marker_is_found_by_its_word_where_the_fixed_box_misses_and_then_tracked() {
        // 1920×1080 full screen: the button is at 1650,905, not in the fixed box. Rule 14: before this change the frame read
        // `Unknown` (the pinned domain test of the previous commit).
        let hud = Hud::new(vec![create_new(1650, 905)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::CharacterSelect);
        let first = hud.take_asked();
        assert_eq!(marker_area_reads(&first), 1, "searched: {first:?}");
        for _ in 0..3 {
            assert_eq!(screens.read(&frame).screen, Screen::CharacterSelect);
            let steady = hud.take_asked();
            assert_eq!(marker_area_reads(&steady), 0, "only tracked: {steady:?}");
            assert!(
                steady.iter().any(|area| area.width < 400
                    && area.x <= 1650
                    && area.y <= 905
                    && area.y > 700),
                "the box around the button is read: {steady:?}"
            );
        }
    }

    #[test]
    fn a_list_marker_that_moves_out_of_its_box_is_searched_again_once() {
        let hud = Hud::new(vec![create_new(1650, 905)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::CharacterSelect);
        hud.take_asked();
        *hud.lines.lock().expect("lines") = vec![create_new(1500, 960)];
        assert_eq!(screens.read(&frame).screen, Screen::CharacterSelect);
        let miss = hud.take_asked();
        assert_eq!(marker_area_reads(&miss), 1, "{miss:?}");
        assert_eq!(screens.read(&frame).screen, Screen::CharacterSelect);
        assert_eq!(marker_area_reads(&hud.take_asked()), 0, "tracked again");
    }

    #[test]
    fn a_frame_that_is_neither_the_list_nor_the_game_reads_the_marker_area_every_second_frame_at_most()
     {
        // Steady state of a menu or a loading screen: nothing is found, so the area cannot be tracked. The search rests one
        // frame after each miss (`LIST_SEARCH_EVERY`): one read in two frames, none in between.
        let hud = Hud::new(vec![]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        let mut per_frame = Vec::new();
        for _ in 0..6 {
            assert_eq!(screens.read(&frame).screen, Screen::Unknown);
            per_frame.push(marker_area_reads(&hud.take_asked()));
        }
        assert_eq!(per_frame, [1, 0, 1, 0, 1, 0]);
    }

    /// ocr-protection (remote-config T23, rule 14): how often the two wide areas are searched while their marker is not
    /// found, as measured before the cadences come from the configuration. 600 looks of a frame that shows nothing: the band
    /// every look, the automap area and the list marker area every second look. They pass on the code as it was and must
    /// pass with the defaults threaded in.
    #[test]
    fn six_hundred_looks_of_nothing_search_each_wide_area_three_hundred_times() {
        let hud = Hud::new(vec![]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        let (mut band, mut automap, mut marker) = (0, 0, 0);
        for _ in 0..600 {
            assert_eq!(screens.read(&frame).screen, Screen::Unknown);
            let asked = hud.take_asked();
            band += band_reads(&asked);
            automap += automap_reads(&asked);
            marker += marker_area_reads(&asked);
        }
        assert_eq!((band, automap, marker), (600, 300, 300));
    }

    /// remote-config T25: the two search periods come from the configuration. 600 looks of a frame that shows nothing search
    /// each wide area 300 times at the default and today's floor of 2, and 60 times at the ceiling of 10; the band is read on
    /// every look whatever the periods.
    #[test]
    fn the_search_cadences_of_the_configuration_set_how_often_each_wide_area_is_read() {
        let searches = |automap_every: u32, list_every: u32| {
            let hud = Hud::new(vec![]);
            let screens = reader(&hud);
            let frame = frame(1920, 1080);
            let mut config = d2rmm_agent_domain::remote_config::Effective::built_in();
            config.cadence.automap_search_every = automap_every;
            config.cadence.list_search_every = list_every;
            let (mut band, mut automap, mut marker) = (0, 0, 0);
            for _ in 0..600 {
                assert_eq!(screens.read_with(&frame, &config).screen, Screen::Unknown);
                let asked = hud.take_asked();
                band += band_reads(&asked);
                automap += automap_reads(&asked);
                marker += marker_area_reads(&asked);
            }
            (band, automap, marker)
        };
        assert_eq!(searches(2, 2), (600, 300, 300), "today's period");
        assert_eq!(searches(10, 10), (600, 60, 60), "the ceiling");
        assert_eq!(searches(10, 2), (600, 60, 300), "each area on its own");
        assert_eq!(searches(2, 10), (600, 300, 60), "each area on its own");
    }

    #[test]
    fn an_in_game_or_automap_frame_never_reads_the_marker_area() {
        // The steady state of the game adds no read for the list marker: the HUD or the automap is found first.
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        for _ in 0..4 {
            assert_eq!(screens.read(&frame).screen, Screen::InGame);
            assert_eq!(marker_area_reads(&hud.take_asked()), 0);
        }
        let map = Hud::new(vec![difficulty(1600, 120)]);
        let screens = reader(&map);
        for _ in 0..4 {
            assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
            assert_eq!(marker_area_reads(&map.take_asked()), 0);
        }
    }

    #[test]
    fn bottom_right_text_that_is_not_the_marker_is_no_list() {
        // Only the word is the marker: a part of it ("Create") does not make a frame the selection screen.
        let hud = Hud::new(vec![TextLine {
            text: "Create".to_string(),
            region: Region {
                x: 1650,
                y: 905,
                width: 70,
                height: 22,
            },
        }]);
        assert_eq!(
            reader(&hud).read(&frame(1920, 1080)).screen,
            Screen::Unknown
        );
    }

    #[test]
    fn the_life_label_is_found_at_every_client_height_of_the_prints() {
        // The label at 826/1033 of the height, 400 px from the left, for the heights of the maintainer's prints.
        for height in [1033u32, 1045, 1056, 1080] {
            let hud = Hud::new(vec![life(400, 826 * height / 1033 + 8)]);
            let reading = reader(&hud).read(&frame(1920, height));
            assert_eq!(reading.screen, Screen::InGame, "1920×{height}");
        }
    }

    #[test]
    fn a_find_at_one_client_size_is_not_tracked_at_another_after_a_loss() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        assert_eq!(screens.read(&frame(1920, 1080)).screen, Screen::InGame);
        hud.lines.lock().expect("lines").clear();
        assert_eq!(screens.read(&frame(1920, 1080)).screen, Screen::Unknown);
        *hud.lines.lock().expect("lines") = vec![life(400, 834)];
        hud.take_asked();
        assert_eq!(screens.read(&frame(1920, 1045)).screen, Screen::InGame);
        assert_eq!(band_reads(&hud.take_asked()), 1, "a new size searches");
    }

    #[test]
    fn after_a_find_only_a_small_box_around_the_line_is_read() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        assert_eq!(band_reads(&hud.take_asked()), 1, "the first frame searches");
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        let asked = hud.take_asked();
        assert_eq!(band_reads(&asked), 0, "the second frame only tracks");
        assert!(
            asked
                .iter()
                .any(|area| area.width < 400 && area.x <= 436 && area.y <= 880)
        );
    }

    #[test]
    fn a_miss_while_tracking_searches_the_band_again() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        hud.take_asked();
        // The line moves out of its box (a layout change): the band finds it again.
        *hud.lines.lock().expect("lines") = vec![life(900, 950)];
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        assert_eq!(band_reads(&hud.take_asked()), 1);
        // And is tracked at the new place.
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        assert_eq!(band_reads(&hud.take_asked()), 0);
    }

    #[test]
    fn a_line_gone_is_not_in_game_and_the_next_frame_searches_the_band() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        hud.lines.lock().expect("lines").clear();
        assert_eq!(screens.read(&frame).screen, Screen::Unknown);
        hud.take_asked();
        assert_eq!(screens.read(&frame).screen, Screen::Unknown);
        assert_eq!(band_reads(&hud.take_asked()), 1);
    }

    #[test]
    fn a_frame_of_another_size_searches_the_band() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        assert_eq!(screens.read(&frame(1920, 1080)).screen, Screen::InGame);
        hud.take_asked();
        assert_eq!(screens.read(&frame(1920, 1056)).screen, Screen::InGame);
        assert_eq!(band_reads(&hud.take_asked()), 1);
    }

    #[test]
    fn a_tracked_hud_costs_one_read_of_its_box_and_a_miss_one_extra_band_search() {
        // Steady state of the in-game frame: the automap area is searched (no automap yet, so it cannot be tracked) and the
        // HUD's small box is read; the band is read only on the first frame and after a miss, then tracking resumes.
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        let small = |asked: &[Region]| asked.iter().filter(|area| area.width < 400).count();
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        let first = hud.take_asked();
        assert_eq!(
            (first.len(), automap_reads(&first), band_reads(&first)),
            (2, 1, 1)
        );
        // The automap area cannot be tracked, so it is searched on every second frame (`AUTOMAP_SEARCH_EVERY`): the
        // ceiling is two reads, and the frame between reads only the tracked box.
        for (frame_number, area_reads) in [(1, 0), (2, 1), (3, 0)] {
            assert_eq!(screens.read(&frame).screen, Screen::InGame);
            let steady = hud.take_asked();
            assert_eq!(
                steady.len(),
                1 + area_reads,
                "frame {frame_number}: the tracked box, and the automap area on every second frame: {steady:?}"
            );
            assert_eq!(
                (automap_reads(&steady), small(&steady), band_reads(&steady)),
                (area_reads, 1, 0),
                "frame {frame_number}"
            );
        }
        // The label moves out of its box: the tracked box, then one band search; the next frame tracks the new place.
        *hud.lines.lock().expect("lines") = vec![life(900, 950)];
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        let miss = hud.take_asked();
        assert_eq!(
            (miss.len(), small(&miss), band_reads(&miss)),
            (3, 1, 1),
            "{miss:?}"
        );
        assert_eq!(screens.read(&frame).screen, Screen::InGame);
        // The automap area's search of that frame found nothing again, so this frame reads only the tracked box.
        let resumed = hud.take_asked();
        assert_eq!((resumed.len(), band_reads(&resumed)), (1, 0), "{resumed:?}");
    }

    #[test]
    fn a_tracked_automap_costs_one_read_of_its_box_and_a_miss_one_extra_area_search() {
        let hud = Hud::new(vec![difficulty(1600, 120)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1056);
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        let first = hud.take_asked();
        assert_eq!(
            (first.len(), automap_reads(&first)),
            (1, 1),
            "searched once"
        );
        for _ in 0..3 {
            assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
            let steady = hud.take_asked();
            assert_eq!((steady.len(), automap_reads(&steady)), (1, 0), "{steady:?}");
        }
        // The line moves: the tracked box misses, the whole area is searched once, and tracking resumes.
        *hud.lines.lock().expect("lines") = vec![difficulty(1500, 200)];
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        let miss = hud.take_asked();
        assert_eq!((miss.len(), automap_reads(&miss)), (2, 1), "{miss:?}");
        assert_eq!(screens.read(&frame).screen, Screen::AutomapOpen);
        let resumed = hud.take_asked();
        assert_eq!(
            (resumed.len(), automap_reads(&resumed)),
            (1, 0),
            "{resumed:?}"
        );
    }

    /// Every `agent.vision.read` span's fields, as text, in creation order.
    type SpanFields = Vec<(String, String)>;

    #[derive(Default)]
    struct Spans {
        recorded: Mutex<Vec<(String, SpanFields)>>,
    }

    struct Writer<'a>(&'a mut Vec<(String, String)>);

    impl tracing::field::Visit for Writer<'_> {
        fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
            self.0.push((field.name().to_string(), value.to_string()));
        }

        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            self.0
                .push((field.name().to_string(), format!("{value:?}")));
        }
    }

    impl tracing::Subscriber for Spans {
        fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
            true
        }

        fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
            let mut fields = Vec::new();
            attrs.record(&mut Writer(&mut fields));
            let mut recorded = self.recorded.lock().expect("spans");
            recorded.push((attrs.metadata().name().to_string(), fields));
            tracing::Id::from_u64(recorded.len() as u64)
        }

        fn record(&self, span: &tracing::Id, values: &tracing::span::Record<'_>) {
            let mut recorded = self.recorded.lock().expect("spans");
            if let Some((_, fields)) = recorded.get_mut(span.into_u64() as usize - 1) {
                values.record(&mut Writer(fields));
            }
        }

        fn record_follows_from(&self, _span: &tracing::Id, _follows: &tracing::Id) {}

        fn event(&self, _event: &tracing::Event<'_>) {}

        fn enter(&self, _span: &tracing::Id) {}

        fn exit(&self, _span: &tracing::Id) {}
    }

    /// The `agent.vision.read` fields of one read, as `screen/search/area_class`.
    pub(super) fn words_of(screens: &ScreenReader, frame: &Rgba) -> String {
        let spans = Arc::new(Spans::default());
        let guard = tracing::subscriber::set_default(Arc::clone(&spans));
        tracing::callsite::rebuild_interest_cache();
        screens.read(frame);
        drop(guard);
        let recorded = spans.recorded.lock().expect("spans");
        let (name, fields) = recorded.last().expect("a span");
        assert_eq!(name, "agent.vision.read");
        let get = |key: &str| {
            fields
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.clone())
                .unwrap_or_default()
        };
        assert_eq!(fields.len(), 3, "three fields and no more: {fields:?}");
        format!(
            "{}/{}/{}",
            get("vision.screen"),
            get("vision.search"),
            get("vision.area_class")
        )
    }

    #[test]
    fn the_read_span_carries_the_screen_the_search_and_the_area_class_as_fixed_words() {
        let hud = Hud::new(vec![life(436, 880)]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        assert_eq!(words_of(&screens, &frame), "in_game/band/band");
        assert_eq!(words_of(&screens, &frame), "in_game/track/box");
        hud.lines.lock().expect("lines").clear();
        assert_eq!(words_of(&screens, &frame), "unknown/band/band");
    }

    #[test]
    fn the_read_span_of_a_frame_that_finds_nothing_is_pinned_frame_by_frame() {
        let hud = Hud::new(vec![]);
        let screens = reader(&hud);
        let frame = frame(1920, 1080);
        let words: Vec<String> = (0..4).map(|_| words_of(&screens, &frame)).collect();
        assert_eq!(
            words,
            [
                "unknown/band/band",
                "unknown/rested/box",
                "unknown/band/band",
                "unknown/rested/box"
            ],
            "changed expectation (#104 fix round 1, was band on every frame): the frame whose list-marker search rests says so"
        );
    }

    #[test]
    fn the_words_of_a_rested_frame_are_fixed_words() {
        use super::{Search, vision_words};
        use d2rmm_agent_domain::presence::Screen;
        assert_eq!(
            vision_words(Screen::Unknown, Some(Search::Rested)),
            ["unknown", "rested", "box"]
        );
        assert_eq!(
            vision_words(Screen::CharacterSelect, Some(Search::Rested)),
            ["character_select", "rested", "panel"]
        );
    }

    #[test]
    fn the_words_of_a_frame_with_no_search_are_fixed_or_none() {
        use super::{Search, vision_words};
        use d2rmm_agent_domain::presence::Screen;
        assert_eq!(
            vision_words(Screen::InGame, None),
            ["in_game", "fixed", "box"]
        );
        assert_eq!(
            vision_words(Screen::CharacterSelect, None),
            ["character_select", "fixed", "panel"]
        );
        assert_eq!(
            vision_words(Screen::Unknown, None),
            ["unknown", "none", "box"]
        );
        assert_eq!(
            vision_words(Screen::AutomapOpen, Some(Search::Track)),
            ["automap", "track", "box"]
        );
    }
}

/// A popup over a list the game dims (screen-recognition T9): the cards behind it are as readable as their pixels are bright.
#[cfg(test)]
mod dim_tests {
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::ScreenReader;
    use crate::ports::{FrameReader, ReadError, Rgba, TextReader};

    /// How bright the brightest pixel of a region must be for the fake engine to read the text there.
    const READABLE: u8 = 180;

    /// A reader of a scene whose lines read only where the frame is bright; every area asked is recorded.
    struct Dimmed {
        lines: Vec<TextLine>,
        asked: Mutex<Vec<Region>>,
    }

    impl Dimmed {
        fn new(lines: Vec<TextLine>) -> Arc<Self> {
            Arc::new(Self {
                lines,
                asked: Mutex::new(Vec::new()),
            })
        }

        fn take_asked(&self) -> Vec<Region> {
            std::mem::take(&mut *self.asked.lock().expect("asked"))
        }

        fn bright(image: &Rgba, area: Region) -> bool {
            (area.y..area.bottom().min(image.height)).any(|y| {
                (area.x..area.right().min(image.width)).any(|x| {
                    let at = (y as usize * image.width as usize + x as usize) * 4;
                    image.pixels[at] >= READABLE
                })
            })
        }

        fn inside(area: Region, line: &TextLine) -> bool {
            let (x, y) = (line.region.middle_x(), line.region.middle_y());
            area.x <= x && x < area.right() && area.y <= y && y < area.bottom()
        }
    }

    impl TextReader for Dimmed {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.lines
                .iter()
                .find(|line| Self::inside(region, line) && Self::bright(image, line.region))
                .map(|line| ReadText {
                    text: line.text.clone(),
                    confidence: 1.0,
                })
                .ok_or(ReadError::Failed)
        }

        fn read_lines(&self, image: &Rgba, region: Region) -> Vec<TextLine> {
            self.asked.lock().expect("asked").push(region);
            self.lines
                .iter()
                .filter(|line| Self::inside(region, line) && Self::bright(image, line.region))
                .cloned()
                .collect()
        }
    }

    fn line(text: &str, x: u32, y: u32, width: u32) -> TextLine {
        TextLine {
            text: text.to_string(),
            region: Region {
                x,
                y,
                width,
                height: 18,
            },
        }
    }

    /// The popup's four lines and the two cards behind it, at the 1920×1080 client's places.
    fn scene() -> Vec<TextLine> {
        vec![
            line("Select Difficulty", 900, 360, 216),
            line("Normal", 900, 430, 200),
            line("Nightmare", 900, 500, 200),
            line("Hell", 900, 570, 200),
            line("vukVuka", 1576, 91, 236),
            line("Level 88 Sorceress", 1576, 114, 236),
            line("vukaDao", 1576, 181, 236),
            line("Level 11 Sorceress", 1576, 204, 236),
        ]
    }

    /// A frame with the popup bright and the card column at `column` brightness.
    fn frame(column: u8) -> Rgba {
        let (width, height) = (1920u32, 1080u32);
        let mut pixels = vec![255u8; width as usize * height as usize * 4];
        let area = screen_region(ScreenRegion::CardColumn, width, height).expect("column");
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                let at = (y as usize * width as usize + x as usize) * 4;
                pixels[at..at + 3].fill(column);
            }
        }
        Rgba {
            width,
            height,
            pixels,
        }
    }

    fn read(reader: &Arc<Dimmed>, frame: &Rgba) -> crate::messages::FrameReading {
        ScreenReader::new(
            Arc::clone(reader) as Arc<dyn TextReader + Send + Sync>,
            Arc::new(LanguagePack::english()),
        )
        .read(frame)
    }

    #[test]
    fn a_popup_over_a_bright_column_reads_both_cards_with_one_read_of_the_column() {
        let reader = Dimmed::new(scene());
        let reading = read(&reader, &frame(255));
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!(reading.cards.len(), 2);
        let column = screen_region(ScreenRegion::CardColumn, 1920, 1080).expect("column");
        let asked = reader.take_asked();
        assert_eq!(asked.iter().filter(|area| **area == column).count(), 1);
    }

    #[test]
    fn a_popup_over_a_column_too_dim_for_the_engine_reads_no_card() {
        // Pinned before the change (the `slots0-options3` class): the dimmed text reads as nothing, so no slot is read.
        let reader = Dimmed::new(scene());
        let reading = read(&reader, &frame(70));
        assert_eq!(reading.screen, Screen::CharacterSelect);
        assert_eq!((reading.cards.len(), reading.slots_read), (0, 0));
        assert_eq!(reading.popup_options, 3);
    }
}

/// remote-config T16/T17: the configuration reaches the areas the reader asks the text port to read, and none configured
/// reads exactly as `read` does.
#[cfg(test)]
mod config_threaded {
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::presence::Screen;
    use d2rmm_agent_domain::remote_config::{Area, Effective};
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::ScreenReader;
    use crate::ports::{FrameReader, ReadError, Rgba, TextReader};

    /// Shows one Life line wherever it is asked about, and records every area asked.
    struct Life {
        asked: Mutex<Vec<Region>>,
        shown: bool,
    }

    impl Life {
        fn new(shown: bool) -> Arc<Self> {
            Arc::new(Self {
                asked: Mutex::new(Vec::new()),
                shown,
            })
        }

        fn take_asked(&self) -> Vec<Region> {
            std::mem::take(&mut *self.asked.lock().expect("asked"))
        }
    }

    impl TextReader for Life {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::Failed)
        }

        fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
            self.asked.lock().expect("asked").push(region);
            let line = Region {
                x: 436,
                y: 880,
                width: 160,
                height: 22,
            };
            let inside = region.x <= line.middle_x()
                && line.middle_x() < region.right()
                && region.y <= line.middle_y()
                && line.middle_y() < region.bottom();
            if self.shown && inside {
                vec![TextLine {
                    text: "Life: 925 / 925".to_string(),
                    region: line,
                }]
            } else {
                Vec::new()
            }
        }
    }

    fn frame() -> Rgba {
        Rgba {
            width: 1920,
            height: 1080,
            pixels: vec![0; 1920 * 1080 * 4],
        }
    }

    fn reader(text: &Arc<Life>) -> ScreenReader {
        ScreenReader::new(
            Arc::clone(text) as Arc<dyn TextReader + Send + Sync>,
            Arc::new(LanguagePack::english()),
        )
    }

    /// The box the second look reads around a line the first one found, for a tracking padding of `pad`.
    fn tracked_box(pad: u32) -> Region {
        let text = Life::new(true);
        let screens = reader(&text);
        let mut config = Effective::built_in();
        config.thresholds.track_pad = pad;
        assert_eq!(screens.read_with(&frame(), &config).screen, Screen::InGame);
        text.take_asked();
        assert_eq!(screens.read_with(&frame(), &config).screen, Screen::InGame);
        text.take_asked()
            .into_iter()
            .find(|area| area.width < 400)
            .expect("a tracked box is read")
    }

    #[test]
    fn the_built_in_configuration_asks_the_same_areas_as_read_look_after_look() {
        let plain = Life::new(true);
        let configured = Life::new(true);
        let (plain_reader, configured_reader) = (reader(&plain), reader(&configured));
        for _ in 0..4 {
            assert_eq!(
                plain_reader.read(&frame()),
                configured_reader.read_with(&frame(), &Effective::built_in())
            );
            assert_eq!(plain.take_asked(), configured.take_asked());
        }
    }

    #[test]
    fn a_configured_hud_band_is_the_area_searched_in_place_of_the_built_in_one() {
        let mut config = Effective::built_in();
        config.regions.hud_band = Some(Area {
            x: 0.0,
            y: 0.8,
            width: 0.5,
            height: 0.15,
        });
        let text = Life::new(false);
        reader(&text).read_with(&frame(), &config);
        let asked = text.take_asked();
        assert!(
            asked.contains(&Region {
                x: 0,
                y: 864,
                width: 960,
                height: 162
            }),
            "{asked:?}"
        );
        assert!(
            !asked.iter().any(|area| area.width == 1920),
            "the built-in band is not read: {asked:?}"
        );
    }

    #[test]
    fn a_configured_band_larger_than_the_built_in_one_is_not_read() {
        let mut config = Effective::built_in();
        config.regions.hud_band = Some(Area {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        });
        let text = Life::new(false);
        reader(&text).read_with(&frame(), &config);
        let asked = text.take_asked();
        assert!(
            asked.contains(&Region {
                x: 0,
                y: 810,
                width: 1920,
                height: 270
            }),
            "the built-in band is: {asked:?}"
        );
        assert!(
            !asked.iter().any(|area| area.height == 1080),
            "the whole client is not: {asked:?}"
        );
    }

    #[test]
    fn the_tracking_padding_comes_from_the_configuration_inside_its_range() {
        let (built_in, wide, narrow) = (tracked_box(24), tracked_box(48), tracked_box(8));
        // 24 is today's padding (25 px at 1080); 48 and 8 move each side by the difference scaled to the client.
        assert_eq!(wide.width - built_in.width, 2 * (50 - 25));
        assert_eq!(built_in.width - narrow.width, 2 * (25 - 8));
        // Outside the range the agent's own limits hold, whatever the configuration says.
        assert_eq!(tracked_box(1000), wide);
        assert_eq!(tracked_box(0), narrow);
    }
}
