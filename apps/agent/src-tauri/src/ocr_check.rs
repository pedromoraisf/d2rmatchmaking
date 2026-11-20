//! The maintainer's Windows OCR check of the screenshots in one folder (apps/agent/README.md, "The Party panel check"). The
//! `ocr_check` test (adapters/windows_ocr.rs) and the standalone `ocr-check.exe` (examples/ocr-check.rs) both call
//! `check_folder`, so both read the five files with the same production reading code. The screenshots are the
//! maintainer's own: nothing here commits, copies or keeps them (ADR 010: the agent reads only the files it is given).
use std::path::Path;
use std::sync::Arc;

use d2rmm_agent_core::messages::FrameReading;
use d2rmm_agent_core::party::read_panel_for;
use d2rmm_agent_core::ports::{FrameReader, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::anchors;
use d2rmm_agent_domain::characters::{Class, Difficulty, Title};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field, read_panel_field};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{PanelRegion, ScreenRegion, panel_region, screen_region};
use d2rmm_agent_domain::presence::Screen;
use d2rmm_agent_domain::vision::{Region, TextLine};

/// The five screenshots the check reads, in the order it prints them: three Party frames, then the selection screen and its
/// difficulty popup. `scripts/agent/ocr-check.mjs` names the same five files.
pub const SCREENSHOTS: [&str; 5] = [
    "maintainer-party-revealed.png",
    "maintainer-party-revealed-tooltip.png",
    "maintainer-party-masked.png",
    "maintainer-select-screen.png",
    "maintainer-select-difficulty.png",
];

/// The room's name the maintainer's Party screenshots show when the name is revealed.
pub const PARTY_ROOM_NAME: &str = "DUEL NK LOCKS";

const PARTY_PREFIX: &str = "maintainer-party-";
const PNG_SUFFIX: &str = ".png";

/// The expected game name of a `maintainer-party-<gamename>.png` file: the name exactly as typed in game
/// (`maintainer-party-mmbaalh-19.png` is `mmbaalh-19`). `None` for the five known files, for any other file, and for a name
/// that is empty, holds a path separator or lacks the shape of a generated game name.
pub fn generated_name_of(file: &str) -> Option<&str> {
    if SCREENSHOTS.contains(&file) {
        return None;
    }
    let name = file.strip_prefix(PARTY_PREFIX)?.strip_suffix(PNG_SUFFIX)?;
    if name.is_empty() || name.contains(['/', '\\']) || !is_generated_game_name(name) {
        return None;
    }
    Some(name)
}

/// What a Party file expects: the public room name revealed or masked for the three known files, the generated name revealed
/// for a `maintainer-party-<gamename>.png`. `None` for any other file.
pub fn party_expectation(file: &str) -> Option<(&str, FieldRead)> {
    match file {
        "maintainer-party-revealed.png" | "maintainer-party-revealed-tooltip.png" => {
            Some((PARTY_ROOM_NAME, FieldRead::Matched))
        }
        "maintainer-party-masked.png" => Some((PARTY_ROOM_NAME, FieldRead::Masked)),
        _ => generated_name_of(file).map(|name| (name, FieldRead::Matched)),
    }
}

/// Whether `name` has the shape of a generated game name (`mm` + activity + difficulty code + `-` + number): such a name is
/// not personal data, so a reason may print the edits against it.
pub fn is_generated_game_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("mm") else {
        return false;
    };
    let Some((head, number)) = rest.split_once('-') else {
        return false;
    };
    !head.is_empty()
        && head.bytes().all(|b| b.is_ascii_lowercase())
        && !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
}

const AUTOMAP_PREFIX: &str = "maintainer-automap-";
const CHAT_PREFIX: &str = "maintainer-chat-";

/// The language of the client a print was taken on, from its file name (`en` or `pt`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrintLanguage {
    English,
    Portuguese,
}

/// What a chat line says happened: a player joined the game or left it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatClass {
    Joined,
    Left,
    /// A print that holds a joined and a left line, and whose file name names no event (`maintainer-chat-en-mmbaalh-19.png`).
    /// Only a verdict reports it, for a file that says no event; a file name never expects it.
    Both,
}

impl ChatClass {
    fn word(self) -> &'static str {
        match self {
            ChatClass::Joined => "joined",
            ChatClass::Left => "left",
            ChatClass::Both => "both",
        }
    }
}

/// What a chat print expects: the client's language, and the event class when the file name says it (`joined-` or `left-`
/// after the language). `None` for the class means the file does not say: the verdict then only needs exactly one class found,
/// and its diagnostics print which (a class is a fixed word, never a read text).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatExpectation {
    pub language: PrintLanguage,
    pub class: Option<ChatClass>,
}

/// The language and the rest of a `<prefix><language>-<rest>.png` file name.
fn language_and_rest<'a>(file: &'a str, prefix: &str) -> Option<(PrintLanguage, &'a str)> {
    let tail = file.strip_prefix(prefix)?.strip_suffix(PNG_SUFFIX)?;
    let (language, rest) = tail.split_once('-')?;
    let language = match language {
        "en" => PrintLanguage::English,
        "pt" => PrintLanguage::Portuguese,
        _ => return None,
    };
    (!rest.is_empty()).then_some((language, rest))
}

/// The generated game name the automap of `maintainer-automap-<language>-<gamename>.png` shows
/// (`maintainer-automap-en-mmbaalh-19.png` is `mmbaalh-19`). `None` for any other file and for a name that lacks the shape of
/// a generated game name.
pub fn automap_expectation(file: &str) -> Option<&str> {
    let (_, name) = language_and_rest(file, AUTOMAP_PREFIX)?;
    is_generated_game_name(name).then_some(name)
}

/// What `maintainer-chat-<language>-<what>.png` expects. `<what>` is `joined-...` or `left-...` (the event), or any other
/// lower-case word, digit and dash run (a generated name, for a print whose event the file does not say). `None` for any
/// other file.
pub fn chat_expectation(file: &str) -> Option<ChatExpectation> {
    let (language, rest) = language_and_rest(file, CHAT_PREFIX)?;
    if !rest
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return None;
    }
    let class = if rest.starts_with("joined-") {
        Some(ChatClass::Joined)
    } else if rest.starts_with("left-") {
        Some(ChatClass::Left)
    } else {
        None
    };
    Some(ChatExpectation { language, class })
}

/// The wide area the automap check reads for the game name line: the whole width of the top quarter of the client. The name
/// sits at the top of the automap, and where it sits across window and full screen is what the first `ocr-real` diagnostics
/// measure (game-name-reading O1), so this is a band, never one box. Diagnostics only until `ScreenRegion::AutomapName`.
pub fn automap_band(width: u32, height: u32) -> Region {
    Region {
        x: 0,
        y: 0,
        width,
        height: height / 4,
    }
}

/// The wide area the chat check reads: the left three fifths of the client, from half its height to 95%. D2R draws the chat at
/// the bottom left, open or fading; where its lines sit is what the first `ocr-real` diagnostics measure (game-name-reading
/// O1). Diagnostics only until `ScreenRegion::ChatArea`.
pub fn chat_band(width: u32, height: u32) -> Region {
    Region {
        x: 0,
        y: height / 2,
        width: width * 3 / 5,
        height: height * 45 / 100,
    }
}

/// The candidate phrases of the chat's joined and left lines, in game text (never a player name). They are not product data:
/// a candidate only becomes one when `ocr-real` shows it found on the matching print (game-name-reading, O1 note). Compared
/// lower-case with the whitespace removed on both sides, since the engine spaces the words unevenly.
const CHAT_CANDIDATES: [(PrintLanguage, ChatClass, &str); 6] = [
    (
        PrintLanguage::English,
        ChatClass::Joined,
        "joined our world",
    ),
    (PrintLanguage::English, ChatClass::Left, "left our world"),
    (
        PrintLanguage::Portuguese,
        ChatClass::Joined,
        "entrou em nosso mundo",
    ),
    (
        PrintLanguage::Portuguese,
        ChatClass::Joined,
        "entrou no nosso mundo",
    ),
    (
        PrintLanguage::Portuguese,
        ChatClass::Left,
        "saiu do nosso mundo",
    ),
    (
        PrintLanguage::Portuguese,
        ChatClass::Left,
        "saiu de nosso mundo",
    ),
];

fn compact(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

/// What the chat band showed, with no text: per variant the number of lines, which candidates were found in some line, whether
/// a line holding one had something before it (the player's name was read) and the boxes of the lines holding one.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChatReading {
    pub lines_per_variant: Vec<usize>,
    pub found: [bool; CHAT_CANDIDATES.len()],
    pub name_read: bool,
    pub boxes: Vec<Region>,
}

/// Reads the chat band as the agent reads a text area (every variant's lines) and keeps no text.
pub fn read_chat(reader: &dyn TextReader, image: &Rgba) -> ChatReading {
    let area = chat_band(image.width, image.height);
    chat_reading(&reader.read_line_variants(image, area))
}

/// `read_chat` over lines already read.
pub fn chat_reading(variants: &[Vec<TextLine>]) -> ChatReading {
    let mut reading = ChatReading {
        lines_per_variant: variants.iter().map(Vec::len).collect(),
        ..ChatReading::default()
    };
    for line in variants.iter().flatten() {
        let text = compact(&line.text);
        let mut holds_one = false;
        for (index, (_, _, phrase)) in CHAT_CANDIDATES.iter().enumerate() {
            if let Some(at) = text.find(&compact(phrase)) {
                reading.found[index] = true;
                reading.name_read |= at > 0;
                holds_one = true;
            }
        }
        if holds_one {
            reading.boxes.push(line.region);
        }
    }
    reading
}

impl ChatReading {
    /// Whether a candidate phrase of `language` and `class` was found.
    pub fn found_class(&self, language: PrintLanguage, class: ChatClass) -> bool {
        CHAT_CANDIDATES
            .iter()
            .zip(self.found)
            .any(|((l, c, _), found)| *l == language && *c == class && found)
    }

    /// The class found among the candidates of `language`: `Ok` when exactly one class was found, else `none` or `both`.
    pub fn class_for(&self, language: PrintLanguage) -> Result<ChatClass, &'static str> {
        match (
            self.found_class(language, ChatClass::Joined),
            self.found_class(language, ChatClass::Left),
        ) {
            (true, false) => Ok(ChatClass::Joined),
            (false, true) => Ok(ChatClass::Left),
            (true, true) => Err("both"),
            (false, false) => Err("none"),
        }
    }
}

/// The chat verdict: exactly one class found among the candidates of the print's language, equal to the expected class when the
/// file names it, with the player's name read before the phrase. The error holds counts, classes and booleans only.
pub fn check_chat_reading(
    reading: &ChatReading,
    expected: ChatExpectation,
) -> Result<ChatClass, String> {
    let lines: usize = reading.lines_per_variant.iter().sum();
    let found = match reading.class_for(expected.language) {
        Ok(class) => class,
        // A print whose file names no event may hold both a joined and a left line.
        Err("both") if expected.class.is_none() => ChatClass::Both,
        Err(which) => {
            return Err(format!(
                "joined or left phrase: {which} found among the candidates of the print's language, {lines} chat lines over {} variants",
                reading.lines_per_variant.len()
            ));
        }
    };
    if let Some(class) = expected.class
        && class != found
    {
        return Err(format!(
            "the event is {}, expected {}",
            found.word(),
            class.word()
        ));
    }
    if !reading.name_read {
        return Err(format!(
            "the {} phrase is found but nothing is read before it (no name)",
            found.word()
        ));
    }
    Ok(found)
}

/// The chat diagnostics of one print: per variant the line count, then one boolean per candidate phrase (`found` or
/// `not found`, never the text read), the class found per language, whether a name was read before the phrase, and the pixel
/// box of every line that holds a candidate. No line's text is printed.
pub fn chat_diagnostics(reading: &ChatReading) -> Vec<String> {
    let mut out = Vec::new();
    for (index, lines) in reading.lines_per_variant.iter().enumerate() {
        out.push(format!("  chat band, variant {index}: {lines} lines"));
    }
    for (index, ((language, class, _), found)) in
        CHAT_CANDIDATES.iter().zip(reading.found).enumerate()
    {
        let language = match language {
            PrintLanguage::English => "en",
            PrintLanguage::Portuguese => "pt",
        };
        out.push(format!(
            "  phrase-candidate-{}={} ({language}, {})",
            index + 1,
            if found { "found" } else { "not found" },
            class.word()
        ));
    }
    for (name, language) in [
        ("en", PrintLanguage::English),
        ("pt", PrintLanguage::Portuguese),
    ] {
        let class = match reading.class_for(language) {
            Ok(class) => class.word(),
            Err(which) => which,
        };
        out.push(format!("  chat event class ({name} candidates): {class}"));
    }
    out.push(format!(
        "  chat name read before the phrase: {}",
        if reading.name_read { "yes" } else { "no" }
    ));
    for line_box in &reading.boxes {
        out.push(format!(
            "  chat line holding a phrase: x {} y {} width {} height {}",
            line_box.x, line_box.y, line_box.width, line_box.height
        ));
    }
    out
}

/// The lines the automap band's line pass returned, per variant.
pub fn read_automap(reader: &dyn TextReader, image: &Rgba) -> Vec<Vec<TextLine>> {
    reader.read_line_variants(image, automap_band(image.width, image.height))
}

/// Whether a line of the automap band has the shape of a generated game name (public, so its text may be printed).
fn name_shaped(text: &str) -> bool {
    is_generated_game_name(&text.trim().to_lowercase())
}

/// The automap verdict: some line of some variant reads as the room's generated name by the production match
/// (`read_field`). The error holds counts and the name-shaped reads (a generated name is public); every other line's text
/// stays out, the band holding other players' text.
pub fn check_automap_reading(
    variants: &[Vec<TextLine>],
    expected_name: &str,
) -> Result<(), String> {
    let lines: Vec<&TextLine> = variants.iter().flatten().collect();
    if lines
        .iter()
        .any(|line| read_field(&line.text, expected_name) == FieldRead::Matched)
    {
        return Ok(());
    }
    let shaped: Vec<&str> = lines
        .iter()
        .map(|line| line.text.trim())
        .filter(|text| name_shaped(text))
        .collect();
    Err(format!(
        "no line of the automap band reads as the expected name: {} lines over {} variants, {} shaped like a generated name {shaped:?}",
        lines.len(),
        variants.len(),
        shaped.len()
    ))
}

/// The automap diagnostics of one print: per variant the number of lines, and per line its box and whether it is shaped like a
/// generated name. A shaped line prints its text (a generated name is public); any other line prints its shape (a letter,
/// a digit or another character each) and never its text.
pub fn automap_diagnostics(variants: &[Vec<TextLine>]) -> Vec<String> {
    let mut out = Vec::new();
    for (index, lines) in variants.iter().enumerate() {
        out.push(format!(
            "  automap band, variant {index}: {} lines",
            lines.len()
        ));
        for line in lines {
            let shaped = name_shaped(&line.text);
            let shown: String = if shaped {
                line.text.trim().to_string()
            } else {
                line.text
                    .chars()
                    .map(|c| {
                        if c.is_alphabetic() {
                            'a'
                        } else if c.is_numeric() {
                            '9'
                        } else {
                            c
                        }
                    })
                    .collect()
            };
            out.push(format!(
                "    x {} y {} width {} height {}: name-shaped {} [{}]",
                line.region.x,
                line.region.y,
                line.region.width,
                line.region.height,
                if shaped { "yes" } else { "no" },
                shown
            ));
        }
    }
    out
}

/// The files the check reads in `dir`: the five known ones, then every `maintainer-party-<gamename>.png`,
/// `maintainer-automap-<language>-<gamename>.png` and `maintainer-chat-<language>-<what>.png` found there, sorted by name. A
/// file of any other name is left alone.
pub fn folder_screenshots(dir: &Path) -> Vec<String> {
    let mut extra: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|file| {
            generated_name_of(file).is_some()
                || automap_expectation(file).is_some()
                || chat_expectation(file).is_some()
        })
        .collect();
    extra.sort();
    SCREENSHOTS
        .iter()
        .map(|name| name.to_string())
        .chain(extra)
        .collect()
}

/// A card as the character checks compare it: name, class, level and title.
pub type Card = (&'static str, Class, u8, Option<Title>);

/// The first two cards of the maintainer's selection screen (2026-11-10): a titled Matriarch and an untitled Sorceress.
pub const MAINTAINER_CARDS: [Card; 2] = [
    ("vukVuka", Class::Sorceress, 88, Some(Title::Matriarch)),
    ("vukaDao", Class::Sorceress, 11, None),
];

/// A PNG, decoded to RGBA8. The error names what failed, so the check prints it for the file.
pub fn read_screenshot(path: &Path) -> Result<Rgba, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("cannot be read: {error}"))?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes))
        .read_info()
        .map_err(|error| format!("is not a PNG: {error}"))?;
    let mut pixels = vec![
        0;
        decoder
            .output_buffer_size()
            .ok_or_else(|| "is too large to decode".to_string())?
    ];
    let info = decoder
        .next_frame(&mut pixels)
        .map_err(|error| format!("does not decode: {error}"))?;
    Ok(Rgba {
        width: info.width,
        height: info.height,
        pixels,
    })
}

/// A committed PNG, decoded to RGBA8. Used by the tests, where a committed image that does not decode is a bug.
pub fn decode_png(path: &str) -> Rgba {
    read_screenshot(Path::new(path)).expect("the committed image decodes")
}

/// Reads one Party frame: the panel must be open, and the Game Name field must read as `expected` for the room's name
/// `expected_name`, with the readings combined as the agent combines them (`read_field_variants`). The error names what was
/// read, so a failure shows the OCR text.
pub fn check_party(
    reader: &dyn TextReader,
    image: &Rgba,
    expected_name: &str,
    expected: FieldRead,
) -> Result<(), String> {
    check_party_reads(reader, image, expected_name, expected, true)
}

/// `check_party`, with the error's text chosen by `show_reads`. Without it the error names no text the engine read from the
/// Game Name field (it is a player's game name): only whether the panel is open and the field's kind (Matched, Masked, Other).
pub fn check_party_reads(
    reader: &dyn TextReader,
    image: &Rgba,
    expected_name: &str,
    expected: FieldRead,
    show_reads: bool,
) -> Result<(), String> {
    let language = LanguagePack::english();
    if panel_region(PanelRegion::PartyPanel, image.width, image.height).is_none() {
        return Err(format!(
            "the Party panel layout is unknown for a {}x{} screenshot",
            image.width, image.height
        ));
    }
    // The panel is read as the agent reads it: by the lines of its area, the field being the line under the label.
    let panel = read_panel_for(reader, &language, image, Some(expected_name), None);
    let field: Vec<String> = panel.field.iter().map(|read| read.text.clone()).collect();
    let field_text = if show_reads {
        format!(", field {field:?}")
    } else {
        String::new()
    };
    let anchors = format!(
        "title found: {}, label found: {}",
        panel.open, panel.label_found
    );
    if !panel.open {
        return Err(format!("the panel is not open: {anchors}{field_text}"));
    }
    let fields: Vec<&str> = field.iter().map(String::as_str).collect();
    let got = read_panel_field(panel.field_source, &fields, expected_name);
    if got == expected {
        Ok(())
    } else {
        Err(format!(
            "the field is {got:?}, expected {expected:?}: {anchors}{field_text}"
        ))
    }
}

/// Checks one character frame: its screen, and its cards in order. Names are compared without case: the game draws them in
/// small caps, so the case of a name is not on the screen (decisions.md, 2026-11-12). The error names what was read.
pub fn check_screen(reading: &FrameReading, screen: Screen, cards: &[Card]) -> Result<(), String> {
    check_screen_reads(reading, screen, cards, true)
}

/// `check_screen`, with the error's text chosen by `show_reads`. Without it the error names no character name: it counts the
/// cards and says, per expected card, whether its name, class, level and title settled to the expected value.
pub fn check_screen_reads(
    reading: &FrameReading,
    screen: Screen,
    cards: &[Card],
    show_reads: bool,
) -> Result<(), String> {
    if reading.screen != screen {
        return Err(format!(
            "the screen is {:?}, expected {screen:?}",
            reading.screen
        ));
    }
    let listed: Vec<String> = reading
        .cards
        .iter()
        .map(|card| {
            format!(
                "{} {:?} {} {:?}",
                card.name().to_lowercase(),
                card.class(),
                card.level(),
                card.title()
            )
        })
        .collect();
    let wanted: Vec<String> = cards
        .iter()
        .map(|(name, class, level, title)| {
            format!("{} {class:?} {level} {title:?}", name.to_lowercase())
        })
        .collect();
    if listed == wanted {
        Ok(())
    } else if show_reads {
        Err(format!("the cards are {listed:?}, expected {wanted:?}"))
    } else {
        Err(redacted_cards(reading, cards))
    }
}

/// What a card mismatch says without a name: the number of cards read and expected, then per expected card whether each
/// field settled to the expected value (`yes`), settled to another (`no`), or the card was not read at all.
fn redacted_cards(reading: &FrameReading, cards: &[Card]) -> String {
    let yes = |same: bool| if same { "yes" } else { "no" };
    let mut text = format!(
        "{} card(s) read, {} expected",
        reading.cards.len(),
        cards.len()
    );
    for (slot, (name, class, level, title)) in cards.iter().enumerate() {
        match reading.cards.get(slot) {
            Some(card) => text.push_str(&format!(
                "; card {slot}: name settled={} class={} level={} title={}",
                yes(card.name().to_lowercase() == name.to_lowercase()),
                yes(card.class() == *class),
                yes(card.level() == *level),
                yes(card.title() == *title),
            )),
            None => text.push_str(&format!("; card {slot}: not read")),
        }
    }
    text
}

/// A region the check reads, for the diagnostics: its name, its rectangle in the screenshot (`None` when the layout has
/// none for that size) and whether it shows a player's text (a character name, a game name), which only `--show-reads` prints.
type Spot = (String, Option<Region>, bool);

/// The regions a screenshot's check reads, by file name: the Party title, label and field for a Party frame; for the
/// selection screen the "Create New" marker and, for each of the first two cards, the title line, the name and the
/// "Level N Class" line; the difficulty popup also its title and three labels.
fn spots(name: &str, width: u32, height: u32) -> Vec<Spot> {
    let panel = |label: &str, region| {
        (
            label.to_string(),
            panel_region(region, width, height),
            label == "Game Name field",
        )
    };
    let screen = |label: String, region| {
        let personal = label.ends_with(" name");
        (label, screen_region(region, width, height), personal)
    };
    // The automap band and the chat area are wide areas whose text is personal until a name is told from it: their reads print
    // only with `--show-reads`, the boxes of what they find print always (`automap_diagnostics`, `chat_diagnostics`).
    if name.starts_with("maintainer-automap") {
        return vec![(
            "Automap name band".to_string(),
            Some(automap_band(width, height)),
            true,
        )];
    }
    if name.starts_with("maintainer-chat") {
        return vec![(
            "Chat area".to_string(),
            Some(chat_band(width, height)),
            true,
        )];
    }
    if name.starts_with("maintainer-party") {
        return vec![
            panel("Party title", PanelRegion::PartyTitle),
            panel("Game Name label", PanelRegion::GameNameLabel),
            panel("Game Name field", PanelRegion::GameNameField),
        ];
    }
    let mut regions = vec![screen("Create New".to_string(), ScreenRegion::CreateNew)];
    for slot in 0..2u8 {
        regions.push(screen(
            format!("card {slot} title line"),
            ScreenRegion::CardTitle(slot),
        ));
        regions.push(screen(
            format!("card {slot} name"),
            ScreenRegion::CardName(slot),
        ));
        regions.push(screen(
            format!("card {slot} class/level line"),
            ScreenRegion::CardLevel(slot),
        ));
    }
    if name == "maintainer-select-difficulty.png" {
        regions.push(screen(
            "popup title".to_string(),
            ScreenRegion::SelectDifficulty,
        ));
        regions.push(screen(
            "popup Normal".to_string(),
            ScreenRegion::PopupNormal,
        ));
        regions.push(screen(
            "popup Nightmare".to_string(),
            ScreenRegion::PopupNightmare,
        ));
        regions.push(screen("popup Hell".to_string(), ScreenRegion::PopupHell));
    }
    regions
}

/// The anchors the agent finds in a screenshot, as one line of counts: the cards found by their level line and the popup
/// options found by their word for a selection screen; whether the panel's title and the "Game Name" label were found, and
/// whether the field was read, for a Party frame. Counts and yes/no only: no line of text, no pixel, so the CI log stays free
/// of other players' names.
pub fn anchor_line(
    name: &str,
    reader: &dyn TextReader,
    screens: &ScreenReader,
    image: &Rgba,
) -> String {
    let yes = |found: bool| if found { "yes" } else { "no" };
    if name.starts_with("maintainer-party") {
        let panel = read_panel_for(reader, &LanguagePack::english(), image, None, None);
        return format!(
            "  anchors: title found {}, game-name label found {}, game-name field read {}",
            yes(panel.open),
            yes(panel.label_found),
            yes(!panel.field.is_empty())
        );
    }
    if name.starts_with("maintainer-automap") {
        let variants = read_automap(reader, image);
        let shaped = variants
            .iter()
            .flatten()
            .filter(|line| name_shaped(&line.text))
            .count();
        return format!("  anchors: name-shaped lines found {shaped}");
    }
    if name.starts_with("maintainer-chat") {
        let reading = read_chat(reader, image);
        return format!(
            "  anchors: phrase candidates found {} of {}, name read {}",
            reading.found.iter().filter(|found| **found).count(),
            reading.found.len(),
            yes(reading.name_read)
        );
    }
    let counts = screens.anchor_counts(image);
    format!(
        "  anchors: cards found {}, popup options found {}",
        counts.cards, counts.popup_options
    )
}

/// What the line pass found in a Party frame's panel area, per variant, with no text: the number of lines and, per line, its
/// y and height and the anchor it matched (title, label, password or none). Tells whether the pass returned the label as a
/// line of its own.
pub fn party_line_diagnostics(reader: &dyn TextReader, image: &Rgba) -> Vec<String> {
    let Some(area) = panel_region(PanelRegion::PartyPanel, image.width, image.height) else {
        return Vec::new();
    };
    let pack = LanguagePack::english();
    let mut out = Vec::new();
    for (index, lines) in reader.read_line_variants(image, area).iter().enumerate() {
        out.push(format!(
            "  line pass, variant {index}: {} lines",
            lines.len()
        ));
        for line in lines {
            out.push(format!(
                "    y {} height {}: {}",
                line.region.y,
                line.region.height,
                anchors::party_line_anchor(&pack, &line.text)
            ));
        }
    }
    out
}

/// What the line pass finds in a wide area of the client's top-left (screen-recognition T6, SCR-04): per variant, every line
/// with its box and the anchor it matched. The text of a line is printed in clear only when it reads as the Party title or the
/// Game Name label (either language) or as a generated game name; every other line, whatever its y, prints its shape (a
/// letter, a digit or another character each), never its text, so no player name or BattleTag reaches the public CI log.
pub fn party_wide_diagnostics(reader: &dyn TextReader, image: &Rgba) -> Vec<String> {
    let area = Region {
        x: 0,
        y: 0,
        width: image.width * 30 / 100,
        height: image.height * 40 / 100,
    };
    let pack = LanguagePack::english();
    let brazilian = LanguagePack::brazilian_party();
    let mut out = Vec::new();
    for (index, lines) in reader.read_line_variants(image, area).iter().enumerate() {
        out.push(format!(
            "  wide pass, variant {index}: {} lines",
            lines.len()
        ));
        for line in lines {
            let anchor = anchors::party_line_anchor(&pack, &line.text);
            let portuguese = anchors::party_line_anchor(&brazilian, &line.text);
            let clear = matches!(anchor, "title" | "label")
                || matches!(portuguese, "title" | "label")
                || is_generated_game_name(line.text.trim());
            let shown: String = if clear {
                line.text.clone()
            } else {
                line.text
                    .chars()
                    .map(|c| {
                        if c.is_alphabetic() {
                            'a'
                        } else if c.is_numeric() {
                            '9'
                        } else {
                            c
                        }
                    })
                    .collect()
            };
            out.push(format!(
                "    x {} y {} width {} height {}: {} [{}]",
                line.region.x, line.region.y, line.region.width, line.region.height, anchor, shown
            ));
        }
    }
    out
}

/// The readers whose text the diagnostics print for each region, by label (nearest and bilinear at 2x, 3x, 4x and 5x); the agent
/// reads the six of 3x, 4x and 5x (characters-reading T24).
pub type Variants = Vec<(String, Arc<dyn TextReader + Send + Sync>)>;

/// What a hidden personal read prints instead of its text.
const HIDDEN: &str = "(read hidden: --show-reads prints it, local runs only)";

/// The diagnostic lines of one screenshot, printed before its verdict: the image size, then for each region it reads the
/// rectangle (`x,y WxH`) and, one line per variant, the raw text that variant's engine returned. The text of a character
/// name or of the Game Name field is printed only with `show_reads`: the CI log is public. They never change what counts as
/// PASS.
pub fn diagnostics(name: &str, variants: &Variants, image: &Rgba, show_reads: bool) -> Vec<String> {
    let mut lines = vec![format!("  {name}: image {}x{}", image.width, image.height)];
    for (label, region, personal) in spots(name, image.width, image.height) {
        let Some(area) = region else {
            lines.push(format!("  {label}: no region for this image size"));
            continue;
        };
        lines.push(format!(
            "  {label}: at {},{} size {}x{}",
            area.x, area.y, area.width, area.height
        ));
        if personal && !show_reads {
            lines.push(format!("    {HIDDEN}"));
            continue;
        }
        for (variant, reader) in variants {
            let text = match reader.read(image, area) {
                Ok(read) => format!("{:?}", read.text),
                Err(error) => format!("does not read: {error:?}"),
            };
            lines.push(format!("    {variant}: {text}"));
        }
    }
    lines
}

/// The verdict of one screenshot, by its file name. A file the check does not know has no verdict.
fn verdict(
    name: &str,
    reader: &dyn TextReader,
    screens: &ScreenReader,
    image: &Rgba,
    show_reads: bool,
) -> Result<(), String> {
    if let Some((expected_name, expected)) = party_expectation(name) {
        return check_party_reads(reader, image, expected_name, expected, show_reads);
    }
    if let Some(expected_name) = automap_expectation(name) {
        return check_automap_reading(&read_automap(reader, image), expected_name);
    }
    if let Some(expected) = chat_expectation(name) {
        return check_chat_reading(&read_chat(reader, image), expected).map(|_| ());
    }
    match name {
        "maintainer-select-screen.png" => check_screen_reads(
            &screens.read(image),
            Screen::CharacterSelect,
            &MAINTAINER_CARDS,
            show_reads,
        ),
        "maintainer-select-difficulty.png" => {
            let reading = screens.read(image);
            check_screen_reads(
                &reading,
                Screen::CharacterSelect,
                &MAINTAINER_CARDS,
                show_reads,
            )?;
            let matriarch = reading
                .cards
                .first()
                .map(|card| card.unlocked_difficulties());
            if matriarch
                == Some(vec![
                    Difficulty::Normal,
                    Difficulty::Nightmare,
                    Difficulty::Hell,
                ])
            {
                Ok(())
            } else {
                Err(format!("the popup's difficulties are {matriarch:?}"))
            }
        }
        _ => Err(format!("{name} has no check")),
    }
}

/// Reads the five screenshots in `dir` (and every `maintainer-party-<gamename>.png`) with `reader` (the production reader: it alone decides PASS or FAIL) and prints, per
/// region, the text of each of `variants` (T14); prints one PASS or FAIL line per file with why, and returns the failed file
/// names. Without `show_reads` nothing printed is a character name or a game name (the CI log is public); with it, local
/// runs see every read. A missing file is a failure that names the file. Every file is read before the result is
/// returned, so one run shows every mismatch.
pub fn check_folder(
    dir: &Path,
    reader: Arc<dyn TextReader + Send + Sync>,
    variants: Variants,
    show_reads: bool,
) -> Result<(), Vec<String>> {
    if !dir.is_dir() {
        println!("FAIL {}: is not a folder", dir.display());
        return Err(vec![dir.display().to_string()]);
    }
    let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
    let mut failed = Vec::new();
    for name in &folder_screenshots(dir) {
        let name = name.as_str();
        let path = dir.join(name);
        // The name of a generated-name print is public (the room's generated name): its reads are printed too.
        let show = show_reads || generated_name_of(name).is_some();
        let result = if path.is_file() {
            read_screenshot(&path).and_then(|image| {
                for line in diagnostics(name, &variants, &image, show) {
                    println!("{line}");
                }
                println!("{}", anchor_line(name, &*reader, &screens, &image));
                if name.starts_with("maintainer-party") {
                    for line in party_line_diagnostics(&*reader, &image) {
                        println!("{line}");
                    }
                    for line in party_wide_diagnostics(&*reader, &image) {
                        println!("{line}");
                    }
                }
                if name.starts_with("maintainer-automap") {
                    for line in automap_diagnostics(&read_automap(&*reader, &image)) {
                        println!("{line}");
                    }
                }
                if name.starts_with("maintainer-chat") {
                    for line in chat_diagnostics(&read_chat(&*reader, &image)) {
                        println!("{line}");
                    }
                }
                verdict(name, &*reader, &screens, &image, show)
            })
        } else {
            Err(format!("is missing from {}", dir.display()))
        };
        match result {
            Ok(()) => println!("PASS {name}"),
            Err(error) => {
                println!("FAIL {name}: {error}");
                failed.push(name.to_string());
            }
        }
    }
    if failed.is_empty() {
        Ok(())
    } else {
        Err(failed)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
    use d2rmm_agent_domain::vision::{ReadText, Region};

    use d2rmm_agent_core::messages::FrameReading;
    use d2rmm_agent_domain::characters::{Card as Character, Class, Mode, Title};
    use d2rmm_agent_domain::presence::Screen;

    use super::{MAINTAINER_CARDS, Variants, check_screen_reads, diagnostics};

    /// Returns its own tag and the region's x as the text, so a line shows which variant and region it came from.
    struct EchoReader(&'static str);

    impl TextReader for EchoReader {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: format!("{}{}", self.0, region.x),
                confidence: 1.0,
            })
        }
    }

    fn variants() -> Variants {
        vec![
            ("nearest 3x".to_string(), Arc::new(EchoReader("n"))),
            ("bilinear 3x".to_string(), Arc::new(EchoReader("b"))),
        ]
    }

    fn frame() -> Rgba {
        Rgba {
            width: 1920,
            height: 1033,
            pixels: Vec::new(),
        }
    }

    #[test]
    fn a_party_file_lists_its_size_and_each_region_with_a_line_per_variant() {
        let lines = diagnostics("maintainer-party-revealed.png", &variants(), &frame(), true);
        assert_eq!(
            lines.len(),
            1 + 3 * 3,
            "size, then region + 2 variants, three times: {lines:?}"
        );
        assert_eq!(lines[0], "  maintainer-party-revealed.png: image 1920x1033");
        assert!(lines[1].starts_with("  Party title: at "), "{}", lines[1]);
        assert!(lines[2].starts_with("    nearest 3x: \"n"), "{}", lines[2]);
        assert!(lines[3].starts_with("    bilinear 3x: \"b"), "{}", lines[3]);
        assert!(
            lines[4].starts_with("  Game Name label: at "),
            "{}",
            lines[4]
        );
        assert!(
            lines[7].starts_with("  Game Name field: at "),
            "{}",
            lines[7]
        );
        assert!(lines[1].contains(" size "));
    }

    #[test]
    fn the_selection_screen_lists_the_marker_and_each_card_line_and_the_popup_adds_its_labels() {
        let select = diagnostics("maintainer-select-screen.png", &variants(), &frame(), true);
        assert_eq!(
            select.len(),
            1 + (1 + 6) * 3,
            "size, marker and two cards of three lines"
        );
        let popup = diagnostics(
            "maintainer-select-difficulty.png",
            &variants(),
            &frame(),
            true,
        );
        assert_eq!(
            popup.len(),
            select.len() + 4 * 3,
            "the popup title and three labels"
        );
        assert!(
            popup
                .iter()
                .any(|line| line.starts_with("  popup Hell: at "))
        );
    }

    #[test]
    fn a_size_without_a_layout_says_so() {
        let tiny = Rgba {
            width: 100,
            height: 100,
            pixels: Vec::new(),
        };
        let lines = diagnostics("maintainer-party-masked.png", &variants(), &tiny, true);
        assert!(
            lines[1].ends_with("no region for this image size"),
            "{}",
            lines[1]
        );
    }

    /// Answers every region with a character name, so a line that prints a read shows it.
    struct NameReader;

    impl TextReader for NameReader {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: "VUKVUKA".to_string(),
                confidence: 1.0,
            })
        }
    }

    fn name_variants() -> Variants {
        vec![("nearest 3x".to_string(), Arc::new(NameReader))]
    }

    #[test]
    fn without_show_reads_no_name_region_prints_its_text() {
        for file in [
            "maintainer-party-revealed.png",
            "maintainer-select-screen.png",
            "maintainer-select-difficulty.png",
        ] {
            let lines = diagnostics(file, &name_variants(), &frame(), false);
            let mut region = String::new();
            for line in &lines {
                if !line.starts_with("    ") {
                    region = line.clone();
                }
                let personal = region.contains(" name: at ") || region.contains("Game Name field");
                assert!(
                    !(personal && line.contains("VUKVUKA")),
                    "{file}: {region} printed its read: {line}"
                );
            }
        }
        let lines = diagnostics(
            "maintainer-select-screen.png",
            &name_variants(),
            &frame(),
            false,
        );
        let at = lines
            .iter()
            .position(|l| l.starts_with("  card 0 name: at "))
            .unwrap();
        assert!(lines[at + 1].contains("--show-reads"), "{}", lines[at + 1]);
        assert!(!lines[at + 1].contains("VUKVUKA"));
        let title = lines
            .iter()
            .position(|l| l.starts_with("  card 0 title line: at "))
            .unwrap();
        assert!(
            lines[title + 1].contains("VUKVUKA"),
            "vocabulary regions stay printed"
        );
    }

    #[test]
    fn with_show_reads_the_name_region_prints_its_text() {
        let lines = diagnostics(
            "maintainer-party-revealed.png",
            &name_variants(),
            &frame(),
            true,
        );
        let at = lines
            .iter()
            .position(|l| l.starts_with("  Game Name field: at "))
            .unwrap();
        assert!(lines[at + 1].contains("VUKVUKA"), "{}", lines[at + 1]);
    }

    fn reading(cards: Vec<Character>) -> FrameReading {
        FrameReading {
            screen: Screen::CharacterSelect,
            slots_read: 0,
            popup_options: 0,
            rejected: Vec::new(),
            cards,
        }
    }

    #[test]
    fn a_card_mismatch_names_no_character_without_show_reads() {
        let wrong_level = Character::new(
            "VUKVUKA",
            Class::Sorceress,
            87,
            Mode::Softcore,
            Some(Title::Matriarch),
        );
        let other = Character::new("Vukadan", Class::Sorceress, 11, Mode::Softcore, None);
        let shown = reading(vec![wrong_level.unwrap(), other.unwrap()]);
        let error = check_screen_reads(&shown, Screen::CharacterSelect, &MAINTAINER_CARDS, false)
            .unwrap_err();
        assert!(!error.to_lowercase().contains("vukvuka"), "{error}");
        assert!(!error.to_lowercase().contains("vukadan"), "{error}");
        assert_eq!(
            error,
            "2 card(s) read, 2 expected; card 0: name settled=yes class=yes level=no title=yes; card 1: name settled=no class=yes level=yes title=yes"
        );
        let error = check_screen_reads(
            &reading(vec![]),
            Screen::CharacterSelect,
            &MAINTAINER_CARDS,
            false,
        )
        .unwrap_err();
        assert_eq!(
            error,
            "0 card(s) read, 2 expected; card 0: not read; card 1: not read"
        );
        let error = check_screen_reads(&shown, Screen::CharacterSelect, &MAINTAINER_CARDS, true)
            .unwrap_err();
        assert!(
            error.contains("vukvuka"),
            "show_reads restores the full error: {error}"
        );
    }

    /// Answers the lines it was built with that sit in the area, and blank text for any region read again.
    struct LinesReader(Vec<d2rmm_agent_domain::vision::TextLine>);

    impl TextReader for LinesReader {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: String::new(),
                confidence: 0.0,
            })
        }

        fn read_lines(
            &self,
            _image: &Rgba,
            area: Region,
        ) -> Vec<d2rmm_agent_domain::vision::TextLine> {
            self.0
                .iter()
                .filter(|line| {
                    area.y <= line.region.middle_y() && line.region.middle_y() < area.bottom()
                })
                .cloned()
                .collect()
        }
    }

    fn line(text: &str, middle: u32) -> d2rmm_agent_domain::vision::TextLine {
        d2rmm_agent_domain::vision::TextLine {
            text: text.to_string(),
            region: Region {
                x: 1560,
                y: middle - 8,
                width: 200,
                height: 16,
            },
        }
    }

    #[test]
    fn the_anchor_line_counts_what_it_found_and_names_no_text() {
        use d2rmm_agent_core::screen_reader::ScreenReader;
        use d2rmm_agent_domain::language::LanguagePack;

        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(LinesReader(vec![
            line("ONLINE OFFLINE", 53),
            line("MATRIARCH", 87),
            line("vukVuka", 118),
            line("Level 88 Sorceress", 141),
            line("vukaDao", 210),
            line("Level 11 Sorceress", 233),
            line("Normal", 455),
            line("Hell", 586),
        ]));
        let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
        let shown = super::anchor_line(
            "maintainer-select-difficulty.png",
            &*reader,
            &screens,
            &image,
        );
        assert_eq!(shown, "  anchors: cards found 2, popup options found 2");
        assert!(!shown.to_lowercase().contains("vuk"));
    }

    #[test]
    fn the_wide_diagnostics_print_only_anchor_and_game_name_lines_in_clear() {
        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        // "Vuk#1234" sits on the title's row (the old 9% to 18% band): it prints as its shape all the same.
        let reader = LinesReader(vec![
            line("PARTY", 153),
            line("Vuk#1234", 160),
            line("Vuk Bob 12", 300),
            line("GRUPO", 175),
            line("mmbaalm-99", 190),
        ]);
        let lines = super::party_wide_diagnostics(&reader, &image);
        assert_eq!(lines[0], "  wide pass, variant 0: 5 lines");
        assert!(lines[1].ends_with("title [PARTY]"), "{}", lines[1]);
        assert!(lines[2].ends_with("none [aaa#9999]"), "{}", lines[2]);
        assert!(lines[3].ends_with("none [aaa aaa 99]"), "{}", lines[3]);
        assert!(lines[4].ends_with("none [GRUPO]"), "{}", lines[4]);
        assert!(lines[5].ends_with("none [mmbaalm-99]"), "{}", lines[5]);
        assert!(!lines.join("\n").contains("Vuk"));
    }

    #[test]
    fn the_line_pass_diagnostics_name_the_anchor_of_each_line_and_never_its_text() {
        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let reader = LinesReader(vec![
            line("PARTY", 153),
            line("GA me N AllTE", 170),
            line("PA SS W ORD", 230),
            line("mmbaalh-12", 190),
        ]);
        let lines = super::party_line_diagnostics(&reader, &image);
        assert_eq!(
            lines,
            [
                "  line pass, variant 0: 4 lines",
                "    y 145 height 16: title",
                "    y 162 height 16: label",
                "    y 222 height 16: password",
                "    y 182 height 16: none",
            ]
        );
        assert!(!lines.join("\n").contains("mmbaalh"));
    }

    #[test]
    fn the_anchor_line_of_a_party_frame_says_what_was_found_and_nothing_else() {
        use d2rmm_agent_core::screen_reader::ScreenReader;
        use d2rmm_agent_domain::language::LanguagePack;

        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let party = |lines: Vec<d2rmm_agent_domain::vision::TextLine>| {
            let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(LinesReader(lines));
            let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
            super::anchor_line("maintainer-party-revealed.png", &*reader, &screens, &image)
        };
        let mut open = vec![line("PARTY", 153), line("GAME NAME", 192)];
        for l in &mut open {
            l.region.x = 280;
        }
        assert_eq!(
            party(open),
            "  anchors: title found yes, game-name label found yes, game-name field read yes",
            "a label with nothing under it is still read in the box under it"
        );
        assert_eq!(
            party(vec![line("INVENTORY", 153)]),
            "  anchors: title found no, game-name label found no, game-name field read no"
        );
    }

    #[test]
    fn a_party_file_of_another_shape_never_names_an_expected_game_name() {
        use super::generated_name_of;
        for file in [
            "maintainer-party-someone.png",
            "maintainer-party-MMBAALH-19.png",
            "maintainer-party-mmbaalh-.png",
            "maintainer-party-mmbaalh-x.png",
        ] {
            assert_eq!(generated_name_of(file), None, "{file}");
        }
    }

    #[test]
    fn a_generated_party_file_names_its_expected_game_name() {
        use super::generated_name_of;
        assert_eq!(
            generated_name_of("maintainer-party-mmbaalh-19.png"),
            Some("mmbaalh-19")
        );
        assert_eq!(
            generated_name_of("maintainer-party-mmpvpn-10.png"),
            Some("mmpvpn-10")
        );
        // The known files, other files, an empty name and a path are not generated names.
        for file in [
            "maintainer-party-revealed.png",
            "maintainer-party-revealed-tooltip.png",
            "maintainer-party-masked.png",
            "maintainer-party-.png",
            "maintainer-party-a/b.png",
            "maintainer-party-a\\b.png",
            "maintainer-party-mmbaalh-19.jpg",
            "maintainer-party-mmbaalh-19",
            "maintainer-select-screen.png",
            "party-mmbaalh-19.png",
        ] {
            assert_eq!(generated_name_of(file), None, "{file}");
        }
    }

    #[test]
    fn a_party_file_expects_its_own_name() {
        use super::{PARTY_ROOM_NAME, party_expectation};
        use d2rmm_agent_domain::game_name_match::FieldRead;
        assert_eq!(
            party_expectation("maintainer-party-revealed.png"),
            Some((PARTY_ROOM_NAME, FieldRead::Matched))
        );
        assert_eq!(
            party_expectation("maintainer-party-revealed-tooltip.png"),
            Some((PARTY_ROOM_NAME, FieldRead::Matched))
        );
        assert_eq!(
            party_expectation("maintainer-party-masked.png"),
            Some((PARTY_ROOM_NAME, FieldRead::Masked))
        );
        assert_eq!(
            party_expectation("maintainer-party-mmtzh-47.png"),
            Some(("mmtzh-47", FieldRead::Matched))
        );
        assert_eq!(party_expectation("maintainer-select-screen.png"), None);
        assert_eq!(party_expectation("something-else.png"), None);
    }

    #[test]
    fn only_the_shape_of_a_generated_name_is_public() {
        use super::is_generated_game_name;
        for name in ["mmbaalh-19", "mmpvpn-10", "mmheraldsh-56", "mmbaalm-9999"] {
            assert!(is_generated_game_name(name), "{name}");
        }
        for name in [
            "",
            "mm",
            "mm-1",
            "mmbaalh-",
            "mmbaalh",
            "mmbaalh-1a",
            "MMBAALH-19",
            "DUEL NK LOCKS",
            "secret name",
            "xmmbaalh-19",
        ] {
            assert!(!is_generated_game_name(name), "{name}");
        }
    }

    #[test]
    fn the_folder_lists_the_five_files_then_the_generated_party_files_sorted() {
        use super::folder_screenshots;
        let dir = std::env::temp_dir().join(format!("d2rmm-ocr-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for file in [
            "maintainer-party-mmtzh-47.png",
            "maintainer-party-mmbaalh-19.png",
            "maintainer-party-revealed.png",
            "maintainer-party-.png",
            "maintainer-automap-pt-mmchaosh-20.png",
            "maintainer-automap-en-mmbaalh-19.png",
            "maintainer-automap-fr-mmbaalh-19.png",
            "maintainer-chat-pt-left-open-1.png",
            "maintainer-chat-en-mmbaalh-19.png",
            "maintainer-chat-en-Bob.png",
            "notes.txt",
        ] {
            std::fs::write(dir.join(file), b"").unwrap();
        }
        let listed = folder_screenshots(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(listed[..5], super::SCREENSHOTS);
        assert_eq!(
            listed[5..],
            [
                "maintainer-automap-en-mmbaalh-19.png",
                "maintainer-automap-pt-mmchaosh-20.png",
                "maintainer-chat-en-mmbaalh-19.png",
                "maintainer-chat-pt-left-open-1.png",
                "maintainer-party-mmbaalh-19.png",
                "maintainer-party-mmtzh-47.png"
            ]
        );
        assert_eq!(
            folder_screenshots(std::path::Path::new("/does/not/exist")).len(),
            5,
            "an unreadable folder lists the five known files"
        );
    }

    #[test]
    fn an_automap_file_names_its_generated_game_name_and_a_chat_file_its_language_and_event() {
        use super::{
            ChatClass, ChatExpectation, PrintLanguage, automap_expectation, chat_expectation,
        };
        assert_eq!(
            automap_expectation("maintainer-automap-en-mmbaalh-19.png"),
            Some("mmbaalh-19")
        );
        assert_eq!(
            automap_expectation("maintainer-automap-pt-mmchaosh-20.png"),
            Some("mmchaosh-20")
        );
        for file in [
            "maintainer-automap-fr-mmbaalh-19.png",
            "maintainer-automap-en-someone.png",
            "maintainer-automap-en-.png",
            "maintainer-automap-en-mmbaalh-19.jpg",
            "maintainer-automap-mmbaalh-19.png",
            "maintainer-party-mmbaalh-19.png",
        ] {
            assert_eq!(automap_expectation(file), None, "{file}");
        }
        let chat = |file| chat_expectation(file);
        assert_eq!(
            chat("maintainer-chat-en-mmbaalh-19.png"),
            Some(ChatExpectation {
                language: PrintLanguage::English,
                class: None
            })
        );
        assert_eq!(
            chat("maintainer-chat-pt-joined-closed-1.png"),
            Some(ChatExpectation {
                language: PrintLanguage::Portuguese,
                class: Some(ChatClass::Joined)
            })
        );
        assert_eq!(
            chat("maintainer-chat-pt-left-open-1.png"),
            Some(ChatExpectation {
                language: PrintLanguage::Portuguese,
                class: Some(ChatClass::Left)
            })
        );
        for file in [
            "maintainer-chat-fr-joined-1.png",
            "maintainer-chat-en-.png",
            "maintainer-chat-en-Bob.png",
            "maintainer-chat-en-joined-1.jpg",
            "maintainer-chat-joined-1.png",
        ] {
            assert_eq!(chat(file), None, "{file}");
        }
    }

    #[test]
    fn the_automap_and_chat_files_list_their_band_and_hide_its_read_without_show_reads() {
        for (file, label) in [
            ("maintainer-automap-en-mmbaalh-19.png", "Automap name band"),
            ("maintainer-chat-pt-joined-open-1.png", "Chat area"),
        ] {
            let hidden = diagnostics(file, &name_variants(), &frame(), false);
            assert_eq!(hidden.len(), 3, "{file}: size, region, hidden: {hidden:?}");
            assert!(
                hidden[1].starts_with(&format!("  {label}: at ")),
                "{}",
                hidden[1]
            );
            assert!(hidden[2].contains("--show-reads"), "{}", hidden[2]);
            assert!(!hidden.join("\n").contains("VUKVUKA"), "{file}");
            let shown = diagnostics(file, &name_variants(), &frame(), true);
            assert_eq!(shown.len(), 3, "{file}");
            assert!(shown[2].contains("VUKVUKA"), "{file}: {}", shown[2]);
        }
    }

    #[test]
    fn the_bands_are_wide_areas_that_scale_with_the_client() {
        use super::{automap_band, chat_band};
        let top = automap_band(1920, 1080);
        assert_eq!((top.x, top.y, top.width, top.height), (0, 0, 1920, 270));
        let top = automap_band(1920, 1033);
        assert_eq!((top.x, top.y, top.width, top.height), (0, 0, 1920, 258));
        let chat = chat_band(1920, 1080);
        assert_eq!(
            (chat.x, chat.y, chat.width, chat.height),
            (0, 540, 1152, 486)
        );
        assert!(chat.bottom() <= 1080 && chat_band(1920, 1033).bottom() <= 1033);
    }

    fn text_line(text: &str, x: u32, y: u32) -> d2rmm_agent_domain::vision::TextLine {
        d2rmm_agent_domain::vision::TextLine {
            text: text.to_string(),
            region: Region {
                x,
                y,
                width: 300,
                height: 18,
            },
        }
    }

    #[test]
    fn a_chat_reading_finds_each_candidate_by_its_words_whatever_the_spacing_and_case() {
        use super::{ChatClass, PrintLanguage, chat_reading};
        let reading = chat_reading(&[
            vec![
                text_line("Bob JOINED  our world", 10, 700),
                text_line("nothing to see", 10, 730),
            ],
            vec![text_line("Alicesaiu do nosso mundo", 10, 760)],
        ]);
        assert_eq!(reading.lines_per_variant, [2, 1]);
        assert_eq!(reading.found, [true, false, false, false, true, false]);
        assert!(reading.name_read);
        assert_eq!(reading.boxes.len(), 2);
        assert_eq!(
            (reading.boxes[0].x, reading.boxes[0].y),
            (10, 700),
            "the line's box, not its text"
        );
        assert_eq!(
            reading.class_for(PrintLanguage::English),
            Ok(ChatClass::Joined)
        );
        assert_eq!(
            reading.class_for(PrintLanguage::Portuguese),
            Ok(ChatClass::Left)
        );
        let none = chat_reading(&[vec![text_line("Bob says hello", 10, 700)]]);
        assert_eq!(none.found, [false; 6]);
        assert_eq!(none.class_for(PrintLanguage::English), Err("none"));
        let both = chat_reading(&[vec![
            text_line("Bob joined our world", 10, 700),
            text_line("Bob left our world", 10, 730),
        ]]);
        assert_eq!(both.class_for(PrintLanguage::English), Err("both"));
    }

    #[test]
    fn the_chat_verdict_needs_one_class_of_its_language_the_expected_event_and_a_name() {
        use super::{ChatClass, ChatExpectation, PrintLanguage, chat_reading, check_chat_reading};
        let english = |class| ChatExpectation {
            language: PrintLanguage::English,
            class,
        };
        let joined = chat_reading(&[vec![text_line("Bob joined our world", 10, 700)]]);
        assert_eq!(
            check_chat_reading(&joined, english(Some(ChatClass::Joined))),
            Ok(ChatClass::Joined)
        );
        assert_eq!(
            check_chat_reading(&joined, english(None)),
            Ok(ChatClass::Joined),
            "a print whose file names no event reports the class it found"
        );
        assert_eq!(
            check_chat_reading(&joined, english(Some(ChatClass::Left))).unwrap_err(),
            "the event is joined, expected left"
        );
        let portuguese = ChatExpectation {
            language: PrintLanguage::Portuguese,
            class: Some(ChatClass::Joined),
        };
        let error = check_chat_reading(&joined, portuguese).unwrap_err();
        assert!(
            error.starts_with("joined or left phrase: none found"),
            "{error}"
        );
        assert!(error.contains("1 chat lines over 1 variants"), "{error}");
        let nameless = chat_reading(&[vec![text_line("joined our world", 10, 700)]]);
        assert!(
            check_chat_reading(&nameless, english(None))
                .unwrap_err()
                .contains("no name")
        );
    }

    #[test]
    fn a_chat_print_that_names_no_event_accepts_both_and_one_that_names_an_event_does_not() {
        use super::{ChatClass, ChatExpectation, PrintLanguage, chat_reading, check_chat_reading};
        let english = |class| ChatExpectation {
            language: PrintLanguage::English,
            class,
        };
        // The shape of `maintainer-chat-en-mmbaalh-19.png`: one joined line and one left line (made-up names).
        let both = chat_reading(&[vec![
            text_line("Bob joined our world", 24, 656),
            text_line("Eve left our world", 24, 770),
        ]]);
        assert_eq!(
            check_chat_reading(&both, english(None)),
            Ok(ChatClass::Both),
            "a file that names no event accepts both and records it as such"
        );
        for class in [ChatClass::Joined, ChatClass::Left] {
            let error = check_chat_reading(&both, english(Some(class))).unwrap_err();
            assert!(
                error.starts_with("joined or left phrase: both found"),
                "a file naming {class:?} does not accept both: {error}"
            );
        }
        // Both is still refused in the other language, and still needs a name before the phrase.
        let portuguese = ChatExpectation {
            language: PrintLanguage::Portuguese,
            class: None,
        };
        assert!(
            check_chat_reading(&both, portuguese)
                .unwrap_err()
                .starts_with("joined or left phrase: none found")
        );
        let nameless = chat_reading(&[vec![
            text_line("joined our world", 24, 656),
            text_line("left our world", 24, 770),
        ]]);
        assert!(
            check_chat_reading(&nameless, english(None))
                .unwrap_err()
                .contains("no name")
        );
    }

    #[test]
    fn the_chat_diagnostics_print_booleans_classes_and_boxes_and_never_a_line() {
        use super::{chat_diagnostics, chat_reading};
        let reading = chat_reading(&[vec![
            text_line("Secretname joined our world", 11, 701),
            text_line("Another secret line", 10, 730),
        ]]);
        let lines = chat_diagnostics(&reading);
        assert_eq!(lines[0], "  chat band, variant 0: 2 lines");
        assert_eq!(lines[1], "  phrase-candidate-1=found (en, joined)");
        assert_eq!(lines[2], "  phrase-candidate-2=not found (en, left)");
        assert_eq!(lines[6], "  phrase-candidate-6=not found (pt, left)");
        assert_eq!(lines[7], "  chat event class (en candidates): joined");
        assert_eq!(lines[8], "  chat event class (pt candidates): none");
        assert_eq!(lines[9], "  chat name read before the phrase: yes");
        assert_eq!(
            lines[10],
            "  chat line holding a phrase: x 11 y 701 width 300 height 18"
        );
        let all = lines.join("\n").to_lowercase();
        assert!(!all.contains("secret"), "{all}");
        assert!(!all.contains("another"), "{all}");
    }

    #[test]
    fn the_automap_verdict_matches_the_generated_name_by_the_production_rule() {
        use super::{automap_diagnostics, check_automap_reading};
        let spaced_glyph = vec![vec![
            text_line("Vuk#1234", 900, 20),
            text_line("MM8AALH-19", 1500, 40),
        ]];
        assert_eq!(check_automap_reading(&spaced_glyph, "mmbaalh-19"), Ok(()));
        let other = vec![
            vec![text_line("Vuk#1234", 900, 20)],
            vec![text_line("mmbaalh-18", 1500, 40)],
        ];
        let error = check_automap_reading(&other, "mmbaalh-19").unwrap_err();
        assert_eq!(
            error,
            "no line of the automap band reads as the expected name: 2 lines over 2 variants, 1 shaped like a generated name [\"mmbaalh-18\"]"
        );
        assert!(!error.contains("Vuk"), "{error}");
        assert!(check_automap_reading(&[], "mmbaalh-19").is_err());
        let lines = automap_diagnostics(&other);
        assert_eq!(lines[0], "  automap band, variant 0: 1 lines");
        assert_eq!(
            lines[1],
            "    x 900 y 20 width 300 height 18: name-shaped no [aaa#9999]"
        );
        assert_eq!(lines[2], "  automap band, variant 1: 1 lines");
        assert_eq!(
            lines[3],
            "    x 1500 y 40 width 300 height 18: name-shaped yes [mmbaalh-18]"
        );
        assert!(!lines.join("\n").contains("Vuk"));
    }

    #[test]
    fn the_anchor_line_of_an_automap_or_chat_print_counts_and_names_no_text() {
        use d2rmm_agent_core::screen_reader::ScreenReader;
        use d2rmm_agent_domain::language::LanguagePack;
        let image = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };
        let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(LinesReader(vec![
            line("mmbaalh-19", 40),
            line("Secretname joined our world", 700),
        ]));
        let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
        let automap = super::anchor_line(
            "maintainer-automap-en-mmbaalh-19.png",
            &*reader,
            &screens,
            &image,
        );
        assert_eq!(automap, "  anchors: name-shaped lines found 1");
        let chat = super::anchor_line(
            "maintainer-chat-en-mmbaalh-19.png",
            &*reader,
            &screens,
            &image,
        );
        assert_eq!(
            chat,
            "  anchors: phrase candidates found 1 of 6, name read yes"
        );
    }
}
