//! The Party step (design.md § Agent, core; AGN-01, AGN-03, AGN-05, AGN-07). While the agent holds a room assignment, each
//! captured frame is looked at for the Party panel: its title and its Game Name label are read at the panel's regions and
//! checked against the words of the language pack. When the panel is open, the Game Name field is read. The masked value
//! tells the player to click the eye (AGN-04); the expected name posts one observation for the run (AGN-03, AGN-05). Only
//! the match leaves the process, and the span carries whether it matched and whether the field was masked (AGN-07).
//! The OCR runs on a blocking thread; once the run has matched, no further frame is read for it.

use std::num::NonZeroU64;
use std::sync::Arc;

use d2rmm_agent_domain::fusion::{GameNameObservation, fuse};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::ReadText;

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
            };
        }
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
    let reading =
        tokio::task::spawn_blocking(move || read_panel(reader.as_ref(), &language, &frame)).await;
    let Ok(reading) = reading else {
        return;
    };
    let Some(observation) = apply_reading(device, ports, &assignment, reading) else {
        return;
    };
    post_observation::send(device, &ports.read, &observation).await;
}

/// What the Party panel shows in one frame: whether it is open (its title and its label read as their words) and the
/// text of the Game Name field, read only when the panel is open. Plain data, so the OCR can run on a blocking thread.
#[derive(Debug, Clone, PartialEq)]
struct PanelReading {
    open: bool,
    field: Option<ReadText>,
}

/// The OCR of one frame's Party panel. Blocking: called on a blocking thread.
fn read_panel(reader: &dyn TextReader, language: &LanguagePack, frame: &Rgba) -> PanelReading {
    // The title decides: the label is not read, so a closed panel costs one read. The title may be a prefix of the word
    // (a tooltip over it leaves "PAR"); the game's small-caps label reads unreliably and is no longer asked for.
    let open = panel_text(reader, frame, PanelRegion::PartyTitle)
        .is_some_and(|title| language.party_panel_open(&title.text));
    let field = if open {
        panel_text(reader, frame, PanelRegion::GameNameField)
    } else {
        None
    };
    PanelReading { open, field }
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
    );
    let _entered = span.enter();
    if !reading.open {
        return None;
    }
    // A blank field reads as masked (`read_field`): the engine returns nothing for the dots of the masked value.
    let field = reading.field?;
    let run = RunKey::of(assignment);
    match read_field(&field.text, assignment.expected_game_name.as_str()) {
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
            fuse(&field, assignment, now, || ports.read.ids.idempotency_key())
        }
    }
}

/// The text of one panel region, or `None` when the frame has no region for it (an unsupported size, AGN-02) or the reader
/// fails.
fn panel_text(reader: &dyn TextReader, frame: &Rgba, panel: PanelRegion) -> Option<ReadText> {
    let region = panel_region(panel, frame.width, frame.height)?;
    reader.read(frame, region).ok()
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
    use d2rmm_agent_domain::vision::{ReadText, Region};

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

    impl TextReader for Panel {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.threads
                .lock()
                .expect("the thread lock")
                .push(std::thread::current().id());
            let at = |panel| panel_region(panel, image.width, image.height);
            let slot = if at(PanelRegion::PartyTitle) == Some(region) {
                &self.title
            } else if at(PanelRegion::GameNameLabel) == Some(region) {
                &self.label
            } else if at(PanelRegion::GameNameField) == Some(region) {
                &self.field
            } else {
                return Err(ReadError::Failed);
            };
            Ok(ReadText {
                text: slot.lock().expect("the panel lock").clone(),
                confidence: 1.0,
            })
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

    /// The only two fields a reading's span may carry: whether it matched and whether the field was masked.
    fn only(matched: &str, masked: &str) -> Vec<Fields> {
        let fields: Fields = [("matched", matched), ("masked", masked)]
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        vec![fields]
    }

    /// Installs the recording subscriber for the current thread; the test's runtime is single-threaded.
    fn record_spans() -> (Arc<Spans>, tracing::subscriber::DefaultGuard) {
        let spans = Arc::new(Spans::default());
        let guard = tracing::subscriber::set_default(Arc::clone(&spans));
        (spans, guard)
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_of_a_match_says_matched_and_nothing_else() {
        let (spans, _guard) = record_spans();
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.panel, "PARTY", "MMC⊕WSH-1");

        look_at(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("true", "false"),
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

        look_at(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("false", "true"),
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

        look_at(&rig).await;

        assert_eq!(
            read_spans(&spans),
            only("false", "false"),
            "nothing read from the field"
        );
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
}
