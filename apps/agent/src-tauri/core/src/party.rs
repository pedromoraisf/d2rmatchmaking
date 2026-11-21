//! The Party step (design.md § Agent, core; AGN-01, AGN-03, AGN-05, AGN-07). While the agent holds a room assignment, each
//! captured frame is looked at for the Party panel: the lines of the panel's area are read and its title and its Game Name
//! label are found by their text, against the words of the language pack. When the panel is open, the Game Name field, the
//! line just under the label, is read. The masked value
//! tells the player to click the eye (AGN-04); the expected name posts one observation for the run (AGN-03, AGN-05). Only
//! the match leaves the process, and the span carries whether it matched and whether the field was masked (AGN-07).
//! The OCR runs on a blocking thread; once the run has matched, no further frame is read for it.

use std::num::NonZeroU64;
use std::sync::Arc;

use d2rmm_agent_domain::anchors;
use d2rmm_agent_domain::fusion::{GameNameObservation, fuse};
use d2rmm_agent_domain::game_name_match::{
    FieldRead, FieldSource, read_field, read_field_variants, read_panel_field,
};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
use d2rmm_agent_domain::name_diff::closest_reading_diff;
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::{ReadText, Region};

use crate::device_state::DeviceState;
use crate::groups::ReadPorts;
use crate::ports::{ApiGateway, Rgba, TextReader};
use crate::post_observation;

/// The ports of the Party step: the read and post ports the observation path uses, and the language pack's words.
pub struct PartyPorts<G> {
    pub read: ReadPorts<G>,
    pub language: Arc<LanguagePack>,
}

/// The identity of a run (AGN-05): its room, its number and its expected game name. A run is followed, and claimed, by this key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunKey {
    room: String,
    run: NonZeroU64,
    expected: String,
}

impl RunKey {
    /// The key of the run an assignment names.
    pub fn of(assignment: &Assignment) -> Self {
        Self {
            room: assignment.room.as_str().to_string(),
            run: assignment.run,
            expected: assignment.expected_game_name.as_str().to_string(),
        }
    }
}

/// What the Party step has seen for the held run (AGN-05): the run it follows, whether it has posted for it and whether the
/// field last showed the masked value. A new room, run or name starts a new run; the same one keeps its state, so an
/// assignment that the stream repeats does not post twice.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PartyProgress {
    run: Option<RunKey>,
    posted: bool,
    masked: bool,
    last_look: Option<PartyLook>,
    /// Where the panel was last found, and in a client of what size: the next frames read this box first.
    panel_area: Option<(Region, u32, u32)>,
}

/// What the Game Name field showed in one look, as a state and never as the text: the diagnostics show it (never the
/// text itself, NFR-04, NFR-05).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldState {
    /// The field was not read: the panel is closed, or no box was read.
    NotRead,
    /// The field was read and holds no text (the engine returns nothing for the masked dots).
    Empty,
    /// The field showed the masked value.
    Masked,
    /// The field showed a text: the expected name or another.
    Text,
}

impl FieldState {
    /// The code the window maps to a translated line.
    pub fn code(self) -> &'static str {
        match self {
            Self::NotRead => "notRead",
            Self::Empty => "empty",
            Self::Masked => "masked",
            Self::Text => "text",
        }
    }
}

/// How the field was read, for the diagnostics: where, by how many OCR variants, and, for another name, how the closest
/// variant differs from the expected one (`closest_reading_diff`: edit operations in `[a-z0-9 -]`, `?` for any other
/// character, `far` past a few edits). Never the text read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDetail {
    /// `label`, `labelLine` or `layoutBox`.
    pub source: &'static str,
    /// How many OCR variants of the field were read.
    pub variants: usize,
    /// The closest variant's edit operations, only when the field shows another name.
    pub diff: Option<String>,
}

/// The code the window maps to a translated line.
pub fn source_code(source: FieldSource) -> &'static str {
    match source {
        FieldSource::Label => "label",
        FieldSource::LabelLine => "labelLine",
        FieldSource::LayoutBox => "layoutBox",
    }
}

/// The last look at the Party panel for the held run: plain facts, no text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartyLook {
    pub panel_open: bool,
    pub field: FieldState,
    /// The field read as the expected game name.
    pub matched: bool,
    /// How the field was read; `None` when it was not read.
    pub detail: Option<FieldDetail>,
}

/// What a reading of the panel shows, as a state (no text kept). A field whose every variant is blank is `Empty`, even
/// though under a found label it counts as masked for the player's hint (`read_panel_field`).
pub fn look_of(reading: &PanelReading, expected: &str) -> PartyLook {
    if !reading.open {
        return PartyLook {
            panel_open: false,
            field: FieldState::NotRead,
            matched: false,
            detail: None,
        };
    }
    if reading.field.is_empty() {
        return PartyLook {
            panel_open: true,
            field: FieldState::NotRead,
            matched: false,
            detail: Some(FieldDetail {
                source: source_code(reading.field_source),
                variants: 0,
                diff: None,
            }),
        };
    }
    let texts: Vec<&str> = reading
        .field
        .iter()
        .map(|read| read.text.as_str())
        .collect();
    let read = read_panel_field(reading.field_source, &texts, expected);
    let field = if texts.iter().all(|text| text.trim().is_empty()) {
        FieldState::Empty
    } else if read == FieldRead::Masked {
        FieldState::Masked
    } else {
        FieldState::Text
    };
    let matched = read == FieldRead::Matched;
    let diff = if field == FieldState::Text && !matched {
        closest_reading_diff(&texts, expected)
    } else {
        None
    };
    PartyLook {
        panel_open: true,
        field,
        matched,
        detail: Some(FieldDetail {
            source: source_code(reading.field_source),
            variants: texts.len(),
            diff,
        }),
    }
}

impl PartyProgress {
    /// Follows the held assignment: `None` forgets the run, and a different run starts afresh.
    pub fn follow(&mut self, assignment: Option<&Assignment>) {
        let key = assignment.map(RunKey::of);
        if key != self.run {
            *self = Self {
                run: key,
                posted: false,
                masked: false,
                last_look: None,
                panel_area: self.panel_area,
            };
        }
    }

    /// The box the panel was found in, when it was found in a client of this size: a box seen at another size does not apply.
    pub fn tracked_area(&self, width: u32, height: u32) -> Option<Region> {
        self.panel_area
            .filter(|(_, seen_width, seen_height)| (*seen_width, *seen_height) == (width, height))
            .map(|(area, _, _)| area)
    }

    /// Remembers where the panel was found (to read that box first on the next frame), or forgets it after a miss.
    pub fn track_area(&mut self, area: Option<Region>, width: u32, height: u32) {
        self.panel_area = area.map(|area| (area, width, height));
    }

    /// The last look at the panel for the followed run, `None` before one.
    pub fn last_look(&self) -> Option<PartyLook> {
        self.last_look.clone()
    }

    /// Keeps what the latest look saw.
    pub fn saw_look(&mut self, look: PartyLook) {
        self.last_look = Some(look);
    }

    /// Whether `run` is the run this progress follows.
    pub fn follows(&self, run: &RunKey) -> bool {
        self.run.as_ref() == Some(run)
    }

    /// Whether the run's observation has been claimed (posted or dropped after its retries, AD-051).
    pub fn matched(&self) -> bool {
        self.posted
    }

    /// The field showed the masked value and the run has not matched yet: the player must reveal the name (AGN-04).
    pub fn needs_reveal(&self) -> bool {
        self.masked && !self.posted
    }

    /// The field showed the masked value.
    pub fn saw_masked(&mut self) {
        self.masked = true;
    }

    /// The field showed a name that is not masked.
    pub fn saw_shown(&mut self) {
        self.masked = false;
    }

    /// Claims the one observation of `run`. `true` the first time, and only while `run` is the followed run: a claim for
    /// a run that has since been replaced is refused, so a read that started for an old run cannot post for the new one.
    pub fn claim(&mut self, run: &RunKey) -> bool {
        if self.posted || !self.follows(run) {
            return false;
        }
        self.posted = true;
        true
    }
}

/// One look at the Party panel of `frame`. Nothing is read without a held assignment, nothing is read once the run has
/// matched, and nothing is posted while the API is not allowed (no token, or a 426 is pending). The OCR runs on a blocking
/// thread, so the screen loop and the other loops keep running while it reads.
pub async fn look<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    frame: Arc<Rgba>,
) {
    let assignment = device.assignment.borrow().current().cloned();
    let Some(assignment) = assignment else {
        return;
    };
    if !device.api_allowed() || device.with_party(|progress| progress.matched()) {
        return;
    }
    let reader = Arc::clone(&ports.read.reader);
    let language = Arc::clone(&ports.language);
    let expected = assignment.expected_game_name.as_str().to_string();
    let tracked = device.with_party(|progress| progress.tracked_area(frame.width, frame.height));
    let size = (frame.width, frame.height);
    let reading = tokio::task::spawn_blocking(move || {
        read_panel_for(reader.as_ref(), &language, &frame, Some(&expected), tracked)
    })
    .await;
    let Ok(reading) = reading else {
        return;
    };
    device.with_party(|progress| progress.track_area(reading.area, size.0, size.1));
    let Some(observation) = apply_reading(device, ports, &assignment, reading) else {
        return;
    };
    post_observation::send(device, &ports.read, &observation).await;
}

/// What the Party panel shows in one frame: whether it is open (its title and its label read as their words) and the
/// text of the Game Name field, read only when the panel is open. Plain data, so the OCR can run on a blocking thread.
#[derive(Debug, Clone, PartialEq)]
pub struct PanelReading {
    pub open: bool,
    /// Whether the "Game Name" label was found, the anchor of the field (`ocr-check` counts it).
    pub label_found: bool,
    /// The readings of the field, one per OCR variant; empty when the panel is closed, the label was not found or the field
    /// did not read.
    pub field: Vec<ReadText>,
    /// Where `field` was read: under the found label, or, when no variant found the label, in the fixed layout box (T16).
    pub field_source: FieldSource,
    /// The box to read first on the next frames, when the panel and its label were found (tracked like the HUD's label).
    pub area: Option<Region>,
}

/// The OCR of one frame's Party panel, anchored on its content (the full-screen incident, 0.1.3: the panel sits at other
/// offsets in a full-screen client): the lines of the panel's area are read once; the panel is open when a line is its title
/// (the whole word or a prefix of it: a tooltip over the title leaves "PAR"), the "Game Name" label is the line that reads as
/// that word, and the game name is the line just under the label. A field with no line under the label (the masked value's
/// dots, which the engine does not read) is read in the box under the label and reads blank. When no variant found the label,
/// the field's fixed layout box is read instead, and only an exact match or the mask itself counts (`read_panel_field`). The panel area may include
/// the "Password" label (and its field); that text is never used, matched, returned, logged or sent, and a line that reads
/// like it is never taken for the game name. Blocking: called on a blocking thread.
pub fn read_panel(reader: &dyn TextReader, language: &LanguagePack, frame: &Rgba) -> PanelReading {
    read_panel_for(reader, language, frame, None, None)
}

/// The Party anchors of the lines of `area`: the pack's words, and its fallback pack's (the Brazilian words) when the pack's find no panel
/// (screen-recognition T6, SCR-04: the maintainer plays on a pt-BR client). Only the anchors change; the game name is matched
/// as ever. One OCR call set per area.
fn locate(
    reader: &dyn TextReader,
    language: &LanguagePack,
    frame: &Rgba,
    area: Region,
) -> anchors::PartyAnchors {
    let lines = reader.read_line_variants(frame, area);
    let found = anchors::find_party_in_variants(language, &lines, frame.height);
    if found.open {
        return found;
    }
    let Some(fallback) = language.fallback() else {
        return found;
    };
    let fallback = anchors::find_party_in_variants(fallback, &lines, frame.height);
    if fallback.open { fallback } else { found }
}

/// `read_panel` as the agent looks at a frame (screen-recognition T6): the cheap areas first, the wide one only as a
/// fallback. A box tracked from the last frame (`tracked`) is read first; when it misses, or none is held, the fixed box
/// (`PartyFixed`); when that finds no title or no label, the wide area (`PartyPanel`). The box found is returned in
/// `PanelReading::area` for the next frame. The crop under the label is read only when the line read did not give the
/// `expected` name (always, when none is given).
pub fn read_panel_for(
    reader: &dyn TextReader,
    language: &LanguagePack,
    frame: &Rgba,
    expected: Option<&str>,
    tracked: Option<Region>,
) -> PanelReading {
    let mut best: Option<anchors::PartyAnchors> = None;
    let areas = [
        tracked,
        panel_region(PanelRegion::PartyFixed, frame.width, frame.height),
        panel_region(PanelRegion::PartyPanel, frame.width, frame.height),
    ];
    for (index, area) in areas.into_iter().enumerate() {
        let Some(area) = area else { continue };
        let found = locate(reader, language, frame, area);
        if found.open && found.label.is_some() {
            best = Some(found);
            break;
        }
        // The first area that found the title is kept unless a later one finds the label too.
        if best.as_ref().is_none_or(|held| !held.open) {
            best = Some(found);
        }
        // A closed panel (no title in the fixed box, the common frame while the host has not opened it) costs one read, as
        // before: the wide area is the fallback of a title found without its label (the pt-BR client), not of a closed panel.
        if index == 1 && !found.open {
            break;
        }
    }
    let found = best.unwrap_or(anchors::PartyAnchors {
        open: false,
        label: None,
        field: None,
    });
    let (field_area, field_source) = match (found.field, found.label) {
        (Some(line), _) => (Some(line), FieldSource::LabelLine),
        (None, Some(label)) => (
            Some(anchors::field_below(label, frame.height)),
            FieldSource::Label,
        ),
        // No variant found the label: the field's fixed layout box, which proves a match, or a masked field only when the mask is read (`read_panel_field`).
        (None, None) => (
            panel_region(PanelRegion::GameNameField, frame.width, frame.height),
            FieldSource::LayoutBox,
        ),
    };
    let mut field = match field_area {
        Some(area) if found.open => reader.read_variants(
            frame,
            anchors::padded(
                area,
                anchors::line_pad(frame.height),
                frame.width,
                frame.height,
            ),
        ),
        _ => Vec::new(),
    };
    let line_read_it = expected.is_some_and(|name| {
        let reads: Vec<&str> = field.iter().map(|read| read.text.as_str()).collect();
        read_field_variants(&reads, name) == FieldRead::Matched
    });
    if let (true, FieldSource::LabelLine, Some(label), false) =
        (found.open, field_source, found.label, line_read_it)
    {
        // The tight box of a found line reads some names worse than the wider crop under the label (the pt-BR 1045 prints,
        // screen-recognition T6): when the line read did not give the expected name, the box under the label is read too,
        // and a reading already there is not repeated. The match stays exact on any one reading, so no other room's name is
        // accepted.
        let below = anchors::padded(
            anchors::field_below(label, frame.height),
            anchors::line_pad(frame.height),
            frame.width,
            frame.height,
        );
        for read in reader.read_variants(frame, below) {
            if !field.iter().any(|held| held.text == read.text) {
                field.push(read);
            }
        }
    }
    PanelReading {
        open: found.open,
        label_found: found.label.is_some(),
        field,
        field_source,
        area: found
            .label
            .filter(|_| found.open)
            .map(|label| anchors::party_track_box(label, frame.width, frame.height)),
    }
}

/// The synchronous part of the look: updates the run's state and the room view from one reading, and returns the
/// observation to post when the field matched and the run had not claimed one yet.
fn apply_reading<G>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    assignment: &Assignment,
    reading: PanelReading,
) -> Option<GameNameObservation> {
    let span = tracing::info_span!(
        "agent.vision.read-game-name",
        matched = false,
        masked = false,
        panel_open = false,
        field = FieldState::NotRead.code(),
    );
    let _entered = span.enter();
    let seen = look_of(&reading, assignment.expected_game_name.as_str());
    // Two facts `look_of` already computed, as plain state: whether the panel is open and the field's state, never its text.
    span.record("panel_open", seen.panel_open);
    span.record("field", seen.field.code());
    let held = RunKey::of(assignment);
    device.with_party(|progress| {
        // A read that started for a replaced run does not describe the new one.
        if progress.follows(&held) {
            progress.saw_look(seen);
        }
    });
    if !reading.open {
        return None;
    }
    // A blank field under a found label reads as masked (`read_field`): the engine returns nothing for the dots of the
    // masked value. A field read in the layout box reads as masked only when the mask itself is read (`read_panel_field`).
    if reading.field.is_empty() {
        return None;
    }
    let expected = assignment.expected_game_name.as_str();
    let texts: Vec<&str> = reading
        .field
        .iter()
        .map(|read| read.text.as_str())
        .collect();
    let run = RunKey::of(assignment);
    match read_panel_field(reading.field_source, &texts, expected) {
        FieldRead::Masked => {
            span.record("masked", true);
            device.with_party(|progress| progress.saw_masked());
            device.publish_room();
            None
        }
        FieldRead::Other => {
            device.with_party(|progress| progress.saw_shown());
            device.publish_room();
            None
        }
        FieldRead::Matched => {
            span.record("matched", true);
            let claimed = device.with_party(|progress| {
                if !progress.follows(&run) {
                    return false;
                }
                progress.saw_shown();
                progress.claim(&run)
            });
            device.publish_room();
            if !claimed {
                return None;
            }
            let now = ports.read.clock.now_utc();
            // The variant that matched is the reading the observation carries.
            let field = reading
                .field
                .iter()
                .find(|read| read_field(&read.text, expected) == FieldRead::Matched)?;
            fuse(field, assignment, now, || ports.read.ids.idempotency_key())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::{PartyProgress, RunKey};

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    fn key(run: u64, name: &str) -> RunKey {
        RunKey::of(&assignment(run, name))
    }

    #[test]
    fn a_claim_names_its_run_and_refuses_another() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));

        assert!(
            !progress.claim(&key(2, "mmbaalh-13")),
            "a run that is not followed cannot claim"
        );
        assert!(!progress.matched(), "the refused claim changed nothing");
        assert!(
            progress.claim(&key(1, "mmbaalh-12")),
            "the followed run claims"
        );
    }

    #[test]
    fn a_claim_for_a_replaced_run_is_refused_after_the_switch() {
        // A read that started for run 1 cannot post once the stream has moved on to run 2.
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        progress.follow(Some(&assignment(2, "mmbaalh-13")));

        assert!(
            !progress.claim(&key(1, "mmbaalh-12")),
            "run 1 is no longer followed"
        );
        assert!(progress.claim(&key(2, "mmbaalh-13")), "run 2 claims");
    }

    fn assignment(run: u64, name: &str) -> Assignment {
        Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(run).expect("a non-zero run"),
            expected_game_name: GameName::new(name),
            members: Vec::new(),
        }
    }

    #[test]
    fn a_run_claims_one_observation() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));

        assert!(
            progress.claim(&key(1, "mmbaalh-12")),
            "the first claim is the observation"
        );
        assert!(
            !progress.claim(&key(1, "mmbaalh-12")),
            "a second claim of the same run is refused"
        );
        assert!(progress.matched());
    }

    #[test]
    fn a_new_run_claims_again() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim(&key(1, "mmbaalh-12")));

        progress.follow(Some(&assignment(2, "mmbaalh-13")));

        assert!(!progress.matched(), "the new run has not matched");
        assert!(
            progress.claim(&key(2, "mmbaalh-13")),
            "the new run posts for itself"
        );
    }

    #[test]
    fn a_repeated_assignment_keeps_the_claim() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim(&key(1, "mmbaalh-12")));

        progress.follow(Some(&assignment(1, "mmbaalh-12")));

        assert!(progress.matched(), "the stream repeats the same run");
        assert!(
            !progress.claim(&key(1, "mmbaalh-12")),
            "no second observation for it"
        );
    }

    #[test]
    fn the_hint_shows_while_masked_and_not_matched() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(!progress.needs_reveal(), "no reading yet, no hint");

        progress.saw_masked();
        assert!(
            progress.needs_reveal(),
            "a masked field asks for the reveal"
        );

        assert!(progress.claim(&key(1, "mmbaalh-12")));
        assert!(!progress.needs_reveal(), "a match clears the hint");
    }

    #[test]
    fn a_shown_name_after_a_masked_one_clears_the_hint() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        progress.saw_masked();
        assert!(
            progress.needs_reveal(),
            "the masked field asks for the reveal"
        );

        progress.saw_shown();

        assert!(
            !progress.needs_reveal(),
            "the player revealed the name, so the prompt goes away (AGN-04)"
        );
    }

    #[test]
    fn forgetting_the_assignment_clears_the_run() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim(&key(1, "mmbaalh-12")));

        progress.follow(None);

        assert_eq!(progress, PartyProgress::default());
    }
}

#[cfg(test)]
mod look_tests {
    use std::num::NonZeroU64;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::fusion::GameNameObservation;
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::{PartyPorts, look};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::ReadPorts;
    use crate::ports::{
        ApiError, PausedWallClock, ReadError, Rgba, SequentialIds, TextReader, TokenStore,
    };
    use crate::secret::Secret;
    use crate::view::RoomView;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    /// A text reader for the Party panel: each panel region answers its own text, and every read is counted.
    #[derive(Default)]
    struct Panel {
        title: Mutex<String>,
        label: Mutex<String>,
        field: Mutex<String>,
        reads: AtomicUsize,
        threads: Mutex<Vec<std::thread::ThreadId>>,
    }

    impl Panel {
        fn counted(&self) {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.threads
                .lock()
                .expect("the thread lock")
                .push(std::thread::current().id());
        }
    }

    impl TextReader for Panel {
        /// The field is the only thing read again: the box a found line, or the box under the label, is read at.
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.counted();
            let area = panel_region(PanelRegion::PartyPanel, image.width, image.height)
                .ok_or(ReadError::Failed)?;
            if region.x < area.x || region.bottom() > area.bottom() + area.height {
                return Err(ReadError::Failed);
            }
            Ok(ReadText {
                text: self.field.lock().expect("the panel lock").clone(),
                confidence: 1.0,
            })
        }

        /// The panel's lines, drawn where the layout's boxes sit on the reference client; a blank text is no line.
        fn read_lines(&self, image: &Rgba, region: Region) -> Vec<TextLine> {
            self.counted();
            let at = |panel| panel_region(panel, image.width, image.height);
            [
                (PanelRegion::PartyTitle, &self.title),
                (PanelRegion::GameNameLabel, &self.label),
                (PanelRegion::GameNameField, &self.field),
            ]
            .into_iter()
            .filter_map(|(panel, text)| {
                let text = text.lock().expect("the panel lock").clone();
                let line = at(panel)?;
                (!text.trim().is_empty() && region.x <= line.x && line.bottom() <= region.bottom())
                    .then_some(TextLine { text, region: line })
            })
            .collect()
        }
    }

    struct Rig {
        device: DeviceState,
        ports: PartyPorts<FakeApiGateway>,
        gateway: Arc<FakeApiGateway>,
        panel: Arc<Panel>,
    }

    fn rig() -> Rig {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let panel = Arc::new(Panel::default());
        let ports = PartyPorts {
            read: ReadPorts {
                reader: Arc::clone(&panel) as Arc<dyn TextReader + Send + Sync>,
                ids: Arc::new(SequentialIds::new()),
                clock: Arc::new(PausedWallClock::starting_at(
                    "2026-11-10T10:00:00Z".parse().expect("a valid instant"),
                )),
                gateway: Arc::clone(&gateway),
                tokens: tokens as Arc<dyn TokenStore + Send + Sync>,
            },
            language: Arc::new(LanguagePack::english()),
        };
        Rig {
            device,
            ports,
            gateway,
            panel,
        }
    }

    fn assignment(run: u64, name: &str) -> Assignment {
        Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(run).expect("a non-zero run"),
            expected_game_name: GameName::new(name),
            members: Vec::new(),
        }
    }

    fn frame(width: u32, height: u32) -> Rgba {
        Rgba {
            width,
            height,
            pixels: Vec::new(),
        }
    }

    /// Shows the panel: the title, the label ("Game Name") and the field text.
    fn show(panel: &Panel, title: &str, field: &str) {
        *panel.title.lock().expect("the panel lock") = title.to_string();
        *panel.label.lock().expect("the panel lock") = "Game Name".to_string();
        *panel.field.lock().expect("the panel lock") = field.to_string();
    }

    async fn look_at(rig: &Rig) {
        look(&rig.device, &rig.ports, Arc::new(frame(1920, 1033))).await;
    }

    fn posts(gateway: &FakeApiGateway) -> Vec<GameNameObservation> {
        gateway
            .calls()
            .into_iter()
            .filter_map(|call| match call {
                Call::PostObservation(observation) => Some(observation),
                _ => None,
            })
            .collect()
    }

    fn room(rig: &Rig) -> Option<RoomView> {
        rig.device.hub.snapshot().room
    }

    #[tokio::test(start_paused = true)]
    async fn an_open_panel_with_the_expected_name_posts_once_per_run() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "MMC⊕WSH-1");

        look_at(&rig).await;
        look_at(&rig).await;

        let posted = posts(&rig.gateway);
        assert_eq!(posted.len(), 1, "one observation for the run");
        assert_eq!(
            posted[0].game_name, "mmcowsh-1",
            "the expected name, not the glyphs"
        );
        assert_eq!(posted[0].run.get(), 1, "the held run");
        assert!(
            room(&rig).is_some_and(|room| room.matched),
            "the room shows the match"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_masked_field_posts_nothing_and_asks_for_the_reveal() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "xxxxxxxxx");

        look_at(&rig).await;

        assert!(
            posts(&rig.gateway).is_empty(),
            "a masked name is never sent"
        );
        assert!(room(&rig).is_some_and(|room| room.needs_reveal && !room.matched));
    }

    #[tokio::test(start_paused = true)]
    async fn revealing_the_name_clears_the_hint_and_posts() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "xxxxxxxxx");
        look_at(&rig).await;

        show(&rig.panel, "PARTY", "mmcowsh-1");
        look_at(&rig).await;

        assert_eq!(posts(&rig.gateway).len(), 1);
        assert!(room(&rig).is_some_and(|room| !room.needs_reveal && room.matched));
    }

    #[tokio::test(start_paused = true)]
    async fn another_name_posts_nothing() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "mmcowsh-7");

        look_at(&rig).await;

        assert!(posts(&rig.gateway).is_empty());
        assert!(room(&rig).is_some_and(|room| !room.needs_reveal && !room.matched));
    }

    #[tokio::test(start_paused = true)]
    async fn a_blank_field_with_an_open_panel_reads_as_masked() {
        // The engine reads nothing from the masked dots (Windows OCR, the CI fixture): with the panel open, a blank field
        // is the masked value, so the player is asked to reveal the name and nothing is posted.
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "   ");

        look_at(&rig).await;

        assert!(
            room(&rig).is_some_and(|room| room.needs_reveal && !room.matched),
            "a blank field asks for the reveal"
        );
        assert!(posts(&rig.gateway).is_empty(), "nothing is posted");
    }

    #[tokio::test(start_paused = true)]
    async fn no_label_and_the_mask_read_in_the_layout_box_asks_for_the_reveal() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "xxxxxxxx");
        *rig.panel.label.lock().expect("the panel lock") = String::new();

        look_at(&rig).await;

        assert!(posts(&rig.gateway).is_empty(), "nothing is posted");
        assert!(room(&rig).is_some_and(|room| room.needs_reveal && !room.matched));
    }

    #[tokio::test(start_paused = true)]
    async fn a_closed_panel_reads_only_its_title() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "INVENTORY", "mmcowsh-1");

        look_at(&rig).await;

        assert_eq!(
            rig.panel.reads.load(Ordering::SeqCst),
            1,
            "only the title is read"
        );
        assert!(posts(&rig.gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_read_without_an_assignment() {
        let rig = rig();
        show(&rig.panel, "PARTY", "mmcowsh-1");

        look_at(&rig).await;

        assert_eq!(rig.panel.reads.load(Ordering::SeqCst), 0);
        assert!(posts(&rig.gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_read_while_the_api_is_not_allowed() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.device.set_paired(false);
        show(&rig.panel, "PARTY", "mmcowsh-1");

        look_at(&rig).await;

        assert_eq!(rig.panel.reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn an_unsupported_size_reads_nothing() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "mmcowsh-1");

        look(&rig.device, &rig.ports, Arc::new(frame(1024, 768))).await;

        assert_eq!(
            rig.panel.reads.load(Ordering::SeqCst),
            0,
            "4:3 is outside the layout"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_run_posts_again_and_a_repeat_does_not() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(()), Ok(())]);
        show(&rig.panel, "PARTY", "mmcowsh-1");
        look_at(&rig).await;

        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        look_at(&rig).await;
        assert_eq!(
            posts(&rig.gateway).len(),
            1,
            "the same run is not posted again"
        );

        rig.device
            .replace_assignment(Some(assignment(2, "mmcowsh-1")));
        look_at(&rig).await;

        let posted = posts(&rig.gateway);
        assert_eq!(posted.len(), 2, "the next run posts for itself");
        assert_eq!(posted[1].run.get(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_post_is_not_retried_by_the_next_look() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway
            .script_post_observation([Err(ApiError::Invalid)]);
        show(&rig.panel, "PARTY", "mmcowsh-1");

        look_at(&rig).await;
        look_at(&rig).await;

        assert_eq!(
            posts(&rig.gateway).len(),
            1,
            "the run claimed its one observation"
        );
    }

    /// The span of one Party reading (AGN-07).
    const READ_SPAN: &str = "agent.vision.read-game-name";

    /// The fields one span recorded, by name, as text.
    type Fields = std::collections::BTreeMap<String, String>;

    /// A subscriber that keeps every span's name and recorded fields, in creation order. It writes no events and tracks no
    /// context: the tests read only what a span recorded. It is hand-written so core takes no subscriber crate
    /// (the architecture rule keeps subscribers out of core's manifest).
    #[derive(Default)]
    struct Spans {
        recorded: Mutex<Vec<(String, Fields)>>,
    }

    /// Writes a span's fields into a map: booleans as `true` or `false`, anything else as its debug text.
    struct FieldWriter<'a>(&'a mut Fields);

    impl tracing::field::Visit for FieldWriter<'_> {
        fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
            self.0.insert(field.name().to_string(), value.to_string());
        }

        fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
            self.0.insert(field.name().to_string(), value.to_string());
        }

        fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
            self.0
                .insert(field.name().to_string(), format!("{value:?}"));
        }
    }

    impl tracing::Subscriber for Spans {
        fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
            true
        }

        fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
            let mut fields = Fields::new();
            attrs.record(&mut FieldWriter(&mut fields));
            let mut recorded = self.recorded.lock().expect("the span lock");
            recorded.push((attrs.metadata().name().to_string(), fields));
            tracing::Id::from_u64(recorded.len() as u64)
        }

        fn record(&self, span: &tracing::Id, values: &tracing::span::Record<'_>) {
            let mut recorded = self.recorded.lock().expect("the span lock");
            let index = span.into_u64() as usize - 1;
            if let Some((_, fields)) = recorded.get_mut(index) {
                values.record(&mut FieldWriter(fields));
            }
        }

        fn record_follows_from(&self, _span: &tracing::Id, _follows: &tracing::Id) {}

        fn event(&self, _event: &tracing::Event<'_>) {}

        fn enter(&self, _span: &tracing::Id) {}

        fn exit(&self, _span: &tracing::Id) {}
    }

    /// The fields of every Party reading span, one map per span.
    fn read_spans(spans: &Spans) -> Vec<Fields> {
        spans
            .recorded
            .lock()
            .expect("the span lock")
            .iter()
            .filter(|(name, _)| name == READ_SPAN)
            .map(|(_, fields)| fields.clone())
            .collect()
    }

    /// The only four fields a reading's span may carry (AGT-07): whether it matched, whether the field was masked, whether the
    /// panel was open and the field's state. All four are booleans or one of four fixed words; none is text read from the
    /// screen.
    fn only(matched: &str, masked: &str, panel_open: &str, field: &str) -> Vec<Fields> {
        let fields: Fields = [
            ("matched", matched),
            ("masked", masked),
            ("panel_open", panel_open),
            ("field", field),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
        vec![fields]
    }

    /// Installs the recording subscriber for the current thread; the test's runtime is single-threaded.
    /// Other tests run on other threads with no subscriber and register the same callsites; tracing caches that answer
    /// for the whole process (a callsite registered while this subscriber was being installed can cache "never"). The
    /// cache is rebuilt after the subscriber is set, and again just before the look (`look_recorded`), so the span is
    /// recorded under `cargo test` (one process) as under nextest (one process per test).
    fn record_spans() -> (Arc<Spans>, tracing::subscriber::DefaultGuard) {
        let spans = Arc::new(Spans::default());
        let guard = tracing::subscriber::set_default(Arc::clone(&spans));
        tracing::callsite::rebuild_interest_cache();
        (spans, guard)
    }

    /// One look with the interest cache rebuilt first, so the recording subscriber sees the look's span.
    async fn look_recorded(rig: &Rig) {
        tracing::callsite::rebuild_interest_cache();
        look_at(rig).await;
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_of_a_match_says_matched_and_nothing_else() {
        let (spans, _guard) = record_spans();
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "MMC⊕WSH-1");

        look_recorded(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("true", "false", "true", "text"),
            "matched, not masked"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_of_a_masked_field_says_masked_and_nothing_else() {
        let (spans, _guard) = record_spans();
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "xxxxxxxxx");

        look_recorded(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("false", "true", "true", "masked"),
            "masked, not matched"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_of_a_closed_panel_says_neither() {
        let (spans, _guard) = record_spans();
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "INVENTORY", "mmcowsh-1");

        look_recorded(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("false", "false", "false", "notRead"),
            "nothing read from the field"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_of_another_name_says_text_and_holds_no_name() {
        let (spans, _guard) = record_spans();
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "mmbaalh-19");

        look_recorded(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("false", "false", "true", "text"),
            "another name is text, not a match"
        );
        for fields in read_spans(&spans) {
            for (key, value) in fields {
                assert!(
                    !value.contains("mmbaalh") && !value.contains("mmcowsh"),
                    "{key} holds a game name: {value}"
                );
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn after_a_match_the_look_reads_nothing() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "mmcowsh-1");
        look_at(&rig).await;
        let reads = rig.panel.reads.load(Ordering::SeqCst);

        look_at(&rig).await;

        assert_eq!(
            rig.panel.reads.load(Ordering::SeqCst),
            reads,
            "a matched run reads no further frame"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_panel_is_read_off_the_runtime_thread() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "INVENTORY", "mmcowsh-1");
        let here = std::thread::current().id();

        look_at(&rig).await;

        let threads = rig.panel.threads.lock().expect("the thread lock").clone();
        assert!(!threads.is_empty(), "the panel was read");
        assert!(
            threads.iter().all(|thread| *thread != here),
            "the OCR runs on a blocking thread, not on the loop's thread"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_last_look_is_kept_as_state_for_the_diagnostics() {
        use super::{FieldState, PartyLook};
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        // How the field was read is asserted in `anchored_tests`; here only the state.
        let seen = |rig: &Rig| {
            rig.device
                .with_party(|progress| progress.last_look())
                .map(|look| PartyLook {
                    detail: None,
                    ..look
                })
        };
        assert_eq!(seen(&rig), None, "no look yet");

        show(&rig.panel, "INVENTORY", "mmcowsh-1");
        look_at(&rig).await;
        assert_eq!(
            seen(&rig),
            Some(PartyLook {
                panel_open: false,
                field: FieldState::NotRead,
                matched: false,
                detail: None,
            })
        );

        show(&rig.panel, "PARTY", "xxxxxxxxx");
        look_at(&rig).await;
        assert_eq!(
            seen(&rig),
            Some(PartyLook {
                panel_open: true,
                field: FieldState::Masked,
                matched: false,
                detail: None,
            })
        );

        show(&rig.panel, "PARTY", "   ");
        look_at(&rig).await;
        assert_eq!(seen(&rig).map(|look| look.field), Some(FieldState::Empty));

        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "mmcowsh-1");
        look_at(&rig).await;
        assert_eq!(
            seen(&rig),
            Some(PartyLook {
                panel_open: true,
                field: FieldState::Text,
                matched: true,
                detail: None,
            })
        );
    }
}

#[cfg(test)]
mod anchored_tests {
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use d2rmm_agent_domain::game_name_match::FieldSource;

    use super::read_panel;
    use crate::ports::{ReadError, Rgba, TextReader};

    /// A Party panel as the lines pass finds it, with its lines where a client of this height draws them; the field is read
    /// again by the text of the line whose middle its box holds.
    struct Lines(Vec<TextLine>);

    fn line(text: &str, x: u32, middle: u32, width: u32) -> TextLine {
        TextLine {
            text: text.to_string(),
            region: Region {
                x,
                y: middle - 8,
                width,
                height: 16,
            },
        }
    }

    impl TextReader for Lines {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            let found = self.0.iter().find(|line| {
                region.y <= line.region.middle_y() && line.region.middle_y() < region.bottom()
            });
            Ok(ReadText {
                text: found.map(|line| line.text.clone()).unwrap_or_default(),
                confidence: 1.0,
            })
        }

        fn read_lines(&self, _image: &Rgba, area: Region) -> Vec<TextLine> {
            self.0
                .iter()
                .filter(|line| {
                    area.y <= line.region.middle_y() && line.region.middle_y() < area.bottom()
                })
                .cloned()
                .collect()
        }
    }

    /// The pack the agent reads with: English, and the Brazilian Party words (`resources/lang/pt-BR.json`, which the app
    /// crate's test pins to these) as its fallback.
    fn english_with_portuguese() -> LanguagePack {
        let words = [
            ("party", "Grupo"),
            ("gameName", "Nome"),
            ("password", "Senha"),
        ]
        .map(|(key, word)| (key.to_string(), word.to_string()));
        LanguagePack::english()
            .with_fallback(LanguagePack::from_words("pt-BR", words).expect("the pack builds"))
    }

    fn frame(height: u32) -> Rgba {
        Rgba {
            width: 1920,
            height,
            pixels: Vec::new(),
        }
    }

    fn panel(title: u32, label: u32, field: Option<(&str, u32)>) -> Lines {
        let mut lines = vec![
            line("PARTY", 366, title, 60),
            line("GAME NAME", 280, label, 90),
            line("PASSWORD", 285, label + 70, 80),
        ];
        if let Some((text, middle)) = field {
            lines.push(line(text, 255, middle, 140));
        }
        Lines(lines)
    }

    fn fields(reading: &super::PanelReading) -> Vec<&str> {
        reading
            .field
            .iter()
            .map(|read| read.text.as_str())
            .collect()
    }

    #[test]
    fn the_revealed_game_name_is_the_line_under_the_label_in_both_clients() {
        let pack = LanguagePack::english();
        // The maintainer's full-screen print: PARTY 153, the label 192, the revealed name 220. And the maximized client.
        for (height, reader) in [
            (1080, panel(153, 192, Some(("MF-FAST-RUN-O1", 220)))),
            (1033, panel(146, 183, Some(("MF-FAST-RUN-O1", 210)))),
        ] {
            let reading = read_panel(&reader, &pack, &frame(height));
            assert!(reading.open && reading.label_found, "{height}");
            assert_eq!(fields(&reading), ["MF-FAST-RUN-O1"], "{height}");
        }
    }

    /// The Party panel of a pt-BR client at 1920x1045, at the positions the `ocr-real` diagnostics measured (title y 129,
    /// label y 171, field y 199, in line tops; middles here).
    fn portuguese_panel() -> Lines {
        portuguese_panel_named("mmbaalm-99")
    }

    fn portuguese_panel_named(name: &str) -> Lines {
        Lines(vec![
            line("GRUPO", 364, 136, 71),
            line("Nome", 264, 176, 40),
            line(name, 269, 204, 95),
            line("SENHA", 460, 174, 44),
        ])
    }

    #[test]
    fn an_english_panel_at_1045_reads_open_and_a_pt_br_panel_reads_open_too() {
        // Changed expectation (SCR-04, orchestrator's decision): the maintainer plays on a pt-BR client, whose panel the
        // English words never found; the Brazilian words are tried when the pack's find no panel.
        let english = panel(136, 176, Some(("mmbaalm-99", 204)));
        let reading = read_panel(&english, &LanguagePack::english(), &frame(1045));
        assert!(reading.open && reading.label_found);
        assert_eq!(fields(&reading), ["mmbaalm-99"]);
        let reading = read_panel(
            &portuguese_panel(),
            &english_with_portuguese(),
            &frame(1045),
        );
        assert!(reading.open && reading.label_found);
        assert_eq!(fields(&reading), ["mmbaalm-99"]);
    }

    #[test]
    fn a_pt_br_panel_never_confirms_another_rooms_name_and_a_pt_br_word_is_no_panel_elsewhere() {
        use d2rmm_agent_domain::game_name_match::{FieldRead, read_panel_field};
        let reading = read_panel(
            &portuguese_panel(),
            &english_with_portuguese(),
            &frame(1045),
        );
        let reads: Vec<&str> = fields(&reading);
        assert_eq!(
            read_panel_field(reading.field_source, &reads, "mmbaalm-99"),
            FieldRead::Matched
        );
        for other in ["mmbaalm-98", "mmpvpn-99", "mmbaalh-99"] {
            assert_ne!(
                read_panel_field(reading.field_source, &reads, other),
                FieldRead::Matched,
                "{other}"
            );
        }
        // A closed panel in a pt-BR client (another word where the title is) reads nothing.
        let closed = Lines(vec![
            line("INVENTARIO", 364, 136, 71),
            line("Nome", 264, 176, 40),
        ]);
        let reading = read_panel(&closed, &english_with_portuguese(), &frame(1045));
        assert!(!reading.open && reading.field.is_empty());
    }

    /// A reader whose tight line box reads the name badly (a clipped line: "mm T zH-47" with spaces) and whose box under the
    /// label, the wider crop, reads it right: the pt-BR 1045 prints of the `ocr-real` run 44707650229.
    struct TwoBoxes(Lines);

    impl TextReader for TwoBoxes {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            let mut read = self.0.read(image, region)?;
            if region.height < 30 && read.text == "mmtzh-47" {
                read.text = "mm T zH-47".to_string();
            }
            Ok(read)
        }

        fn read_lines(&self, image: &Rgba, area: Region) -> Vec<TextLine> {
            self.0.read_lines(image, area)
        }
    }

    #[test]
    fn the_box_under_the_found_label_is_read_too_so_a_clipped_line_read_does_not_hide_the_name() {
        use d2rmm_agent_domain::game_name_match::{FieldRead, read_panel_field};
        let reader = TwoBoxes(portuguese_panel_named("mmtzh-47"));
        let reading = read_panel(&reader, &english_with_portuguese(), &frame(1045));
        let reads = fields(&reading);
        assert!(reads.contains(&"mm T zH-47"), "the line box: {reads:?}");
        assert!(
            reads.contains(&"mmtzh-47"),
            "the box under the label: {reads:?}"
        );
        assert_eq!(
            read_panel_field(reading.field_source, &reads, "mmtzh-47"),
            FieldRead::Matched
        );
        assert_ne!(
            read_panel_field(reading.field_source, &reads, "mmtzh-48"),
            FieldRead::Matched,
            "another room's name stays refused"
        );
    }

    /// Counts every OCR call it forwards to the panel's fake (one `read` or one `read_lines` is one call), and hides the
    /// "Nome" label from every area that does not start at the client's left edge (a label only the wide area sees).
    struct Counted {
        inner: Lines,
        calls: std::sync::atomic::AtomicUsize,
        label_only_in_the_wide_area: bool,
    }

    impl Counted {
        fn new(inner: Lines, label_only_in_the_wide_area: bool) -> Self {
            Self {
                inner,
                calls: std::sync::atomic::AtomicUsize::new(0),
                label_only_in_the_wide_area,
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    impl TextReader for Counted {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.inner.read(image, region)
        }

        fn read_lines(&self, image: &Rgba, area: Region) -> Vec<TextLine> {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut lines = self.inner.read_lines(image, area);
            let fixed = d2rmm_agent_domain::layout::panel_region(
                d2rmm_agent_domain::layout::PanelRegion::PartyFixed,
                image.width,
                image.height,
            );
            if self.label_only_in_the_wide_area && Some(area) == fixed {
                lines.retain(|line| line.text != "Nome");
            }
            lines
        }
    }

    #[test]
    fn the_steady_state_makes_no_more_ocr_calls_than_before_the_wide_area() {
        // Before T6 a look read the panel's lines once and the field once: two calls. A panel found and tracked, a panel
        // found in the fixed box, and a closed panel must not cost more; only a title without its label reads the wide area.
        use super::read_panel_for;
        use d2rmm_agent_domain::anchors::party_track_box;
        let pt = || portuguese_panel_named("mmbaalm-99");
        let pack = english_with_portuguese();
        let size = frame(1045);

        let first = Counted::new(pt(), false);
        let reading = read_panel_for(&first, &pack, &size, Some("mmbaalm-99"), None);
        assert!(reading.open && reading.label_found);
        assert_eq!(first.calls(), 2, "found in the fixed box: lines + field");
        let tracked = reading.area.expect("the found box is returned to track");

        let again = Counted::new(pt(), false);
        let reading = read_panel_for(&again, &pack, &size, Some("mmbaalm-99"), Some(tracked));
        assert!(reading.open && reading.label_found);
        assert_eq!(again.calls(), 2, "tracked: lines + field, as before");
        assert_eq!(
            reading.area,
            Some(tracked),
            "the same label gives the same box"
        );

        let closed = Counted::new(
            Lines(vec![
                line("INVENTARIO", 364, 136, 71),
                line("Nome", 264, 176, 40),
            ]),
            false,
        );
        let reading = read_panel_for(&closed, &pack, &size, Some("mmbaalm-99"), None);
        assert!(!reading.open && reading.area.is_none());
        assert_eq!(closed.calls(), 1, "a closed panel is one read, as before");

        // A title found without its label reads the wide area, once, and the box found there is tracked.
        let wide = Counted::new(pt(), true);
        let reading = read_panel_for(&wide, &pack, &size, Some("mmbaalm-99"), None);
        assert!(reading.open && reading.label_found);
        assert_eq!(wide.calls(), 3, "fixed box, wide area, field");
        let label = d2rmm_agent_domain::vision::Region {
            x: 264,
            y: 168,
            width: 40,
            height: 16,
        };
        assert_eq!(reading.area, Some(party_track_box(label, 1920, 1045)));
        // Tracked from there, the wide area is not read again.
        let tracked = reading.area;
        let next = Counted::new(pt(), true);
        let reading = read_panel_for(&next, &pack, &size, Some("mmbaalm-99"), tracked);
        assert!(reading.open && reading.label_found);
        assert_eq!(next.calls(), 2);
    }

    #[test]
    fn the_crop_under_the_label_is_read_only_when_the_line_read_missed_the_expected_name() {
        use super::read_panel_for;
        let pack = english_with_portuguese();
        let size = frame(1045);
        let hit = Counted::new(portuguese_panel_named("mmtzh-47"), false);
        read_panel_for(&hit, &pack, &size, Some("mmtzh-47"), None);
        assert_eq!(hit.calls(), 2, "the line read it: no crop");
        let miss = Counted::new(portuguese_panel_named("mmtzh-47"), false);
        read_panel_for(&miss, &pack, &size, Some("mmtzh-99"), None);
        assert_eq!(miss.calls(), 3, "the line read missed: the crop is read");
    }

    #[test]
    fn a_masked_field_without_a_line_is_read_in_the_box_under_the_label_and_reads_blank() {
        let pack = LanguagePack::english();
        let reader = panel(153, 192, None);
        let reading = read_panel(&reader, &pack, &frame(1080));
        assert!(reading.open && reading.label_found);
        assert_eq!(fields(&reading), [""], "blank, which means masked");
    }

    #[test]
    fn a_panel_without_its_label_reads_the_layout_box_and_a_closed_one_reads_none_at_all() {
        let pack = LanguagePack::english();
        let no_label = Lines(vec![
            line("PARTY", 366, 153, 60),
            line("MF-FAST-RUN-O1", 255, 220, 140),
        ]);
        let reading = read_panel(&no_label, &pack, &frame(1080));
        assert!(reading.open && !reading.label_found);
        // Changed expectation (maintainer, in chat, 2026-11-18): with no label the field's layout box is read.
        assert_eq!(reading.field_source, FieldSource::LayoutBox);
        assert_eq!(fields(&reading), ["MF-FAST-RUN-O1"]);
        let blank_box = Lines(vec![line("PARTY", 366, 153, 60)]);
        let reading = read_panel(&blank_box, &pack, &frame(1080));
        assert!(reading.open && !reading.label_found);
        assert_eq!(reading.field_source, FieldSource::LayoutBox);
        assert_eq!(fields(&reading), [""], "read, and blank");
        let closed = Lines(vec![
            line("INVENTORY", 366, 153, 90),
            line("GAME NAME", 280, 192, 90),
        ]);
        let reading = read_panel(&closed, &pack, &frame(1080));
        assert!(!reading.open && reading.field.is_empty());
        assert!(
            !read_panel(&closed, &pack, &frame(768)).open,
            "an unsupported size reads nothing"
        );
    }

    /// GNR-02 pin: the panel's field source, and what `read_panel_field` makes of its reads, for each of the three ways the
    /// field is found (the 1080 positions of the maintainer's full-screen print: PARTY 153, label 192, name 220).
    #[test]
    fn the_field_source_of_a_read_panel_and_what_it_makes_of_each_read_is_pinned() {
        use d2rmm_agent_domain::game_name_match::{FieldRead, read_panel_field};
        let pack = LanguagePack::english();

        let by_line = read_panel(
            &panel(153, 192, Some(("mmcowsh-1", 220))),
            &pack,
            &frame(1080),
        );
        assert_eq!(by_line.field_source, FieldSource::LabelLine);
        let reads = fields(&by_line);
        assert_eq!(
            read_panel_field(by_line.field_source, &reads, "mmcowsh-1"),
            FieldRead::Matched
        );
        assert_eq!(
            read_panel_field(by_line.field_source, &reads, "mmcowsh-2"),
            FieldRead::Other
        );

        let by_label = read_panel(&panel(153, 192, None), &pack, &frame(1080));
        assert_eq!(by_label.field_source, FieldSource::Label);
        let reads = fields(&by_label);
        assert_eq!(
            read_panel_field(by_label.field_source, &reads, "mmcowsh-1"),
            FieldRead::Masked,
            "a blank field under a found label is masked"
        );

        let no_label = Lines(vec![line("PARTY", 366, 153, 60)]);
        let by_box = read_panel(&no_label, &pack, &frame(1080));
        assert_eq!(by_box.field_source, FieldSource::LayoutBox);
        let reads = fields(&by_box);
        assert_eq!(
            read_panel_field(by_box.field_source, &reads, "mmcowsh-1"),
            FieldRead::Other,
            "a blank layout box proves nothing"
        );
    }
}

#[cfg(test)]
mod look_state_tests {
    use d2rmm_agent_domain::game_name_match::FieldSource;
    use d2rmm_agent_domain::vision::ReadText;

    use super::{FieldDetail, FieldState, PanelReading, PartyLook, PartyProgress, look_of};

    fn reading(open: bool, source: FieldSource, texts: &[&str]) -> PanelReading {
        PanelReading {
            open,
            label_found: true,
            field: texts
                .iter()
                .map(|text| ReadText {
                    text: (*text).to_string(),
                    confidence: 1.0,
                })
                .collect(),
            field_source: source,
            area: None,
        }
    }

    fn look(panel_open: bool, field: FieldState, matched: bool) -> PartyLook {
        PartyLook {
            panel_open,
            field,
            matched,
            detail: None,
        }
    }

    /// `look` with how the field was read.
    fn look_with(
        field: FieldState,
        matched: bool,
        source: &'static str,
        variants: usize,
        diff: Option<&str>,
    ) -> PartyLook {
        PartyLook {
            detail: Some(FieldDetail {
                source,
                variants,
                diff: diff.map(str::to_string),
            }),
            ..look(true, field, matched)
        }
    }

    #[test]
    fn a_closed_panel_reads_no_field() {
        let closed = reading(false, FieldSource::Label, &[]);
        assert_eq!(
            look_of(&closed, "mmbaalh-16"),
            look(false, FieldState::NotRead, false)
        );
    }

    #[test]
    fn an_open_panel_with_no_field_read_is_open_and_not_read() {
        let open = reading(true, FieldSource::Label, &[]);
        assert_eq!(
            look_of(&open, "mmbaalh-16"),
            look_with(FieldState::NotRead, false, "label", 0, None)
        );
    }

    #[test]
    fn a_blank_field_is_empty_even_though_it_counts_as_masked() {
        let blank = reading(true, FieldSource::Label, &["", "  "]);
        assert_eq!(
            look_of(&blank, "mmbaalh-16"),
            look_with(FieldState::Empty, false, "label", 2, None)
        );
    }

    #[test]
    fn the_mask_is_masked() {
        let masked = reading(true, FieldSource::Label, &["xxxxxxxxxx"]);
        assert_eq!(
            look_of(&masked, "mmbaalh-16"),
            look_with(FieldState::Masked, false, "label", 1, None)
        );
    }

    #[test]
    fn another_name_is_text_that_did_not_match() {
        let other = reading(true, FieldSource::Label, &["mmbaalh-17"]);
        assert_eq!(
            look_of(&other, "mmbaalh-16"),
            look_with(FieldState::Text, false, "label", 1, Some("sub(7>6)@9"))
        );
    }

    #[test]
    fn another_name_names_the_edits_of_its_closest_variant_and_the_source_and_count() {
        let other = reading(
            true,
            FieldSource::LabelLine,
            &["", "zzzzzzzzzz", "mmbaalh-1l", "mmbaalh-lg"],
        );
        assert_eq!(
            look_of(&other, "mmbaalh-19"),
            look_with(FieldState::Text, false, "labelLine", 4, Some("sub(1>9)@9"))
        );
        let far = reading(true, FieldSource::LayoutBox, &["qqqqqqqqqqqq"]);
        assert_eq!(
            look_of(&far, "mmbaalh-19"),
            look_with(FieldState::Text, false, "layoutBox", 1, Some("far"))
        );
    }

    #[test]
    fn the_expected_name_is_text_that_matched() {
        let shown = reading(true, FieldSource::Label, &["mmbaalh-16"]);
        assert_eq!(
            look_of(&shown, "mmbaalh-16"),
            look_with(FieldState::Text, true, "label", 1, None)
        );
    }

    #[test]
    fn the_codes_name_each_state() {
        assert_eq!(FieldState::NotRead.code(), "notRead");
        assert_eq!(FieldState::Empty.code(), "empty");
        assert_eq!(FieldState::Masked.code(), "masked");
        assert_eq!(FieldState::Text.code(), "text");
    }

    #[test]
    fn a_look_is_kept_until_the_run_changes() {
        use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
        let assignment = |run: u64| Assignment {
            room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
            run: std::num::NonZeroU64::new(run).expect("a non-zero run"),
            expected_game_name: GameName::new("mmbaalh-16"),
            members: Vec::new(),
        };
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1)));
        assert_eq!(progress.last_look(), None);

        progress.saw_look(look(true, FieldState::Masked, false));
        progress.follow(Some(&assignment(1)));
        assert_eq!(
            progress.last_look(),
            Some(look(true, FieldState::Masked, false)),
            "the same run keeps its look"
        );

        progress.follow(Some(&assignment(2)));
        assert_eq!(progress.last_look(), None, "a new run starts afresh");
    }
}
