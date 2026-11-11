//! The Party step (design.md § Agent, core; AGN-01, AGN-03, AGN-05, AGN-07). While the agent holds a room assignment, each
//! captured frame is looked at for the Party panel: its title and its Game Name label are read at the panel's regions and
//! checked against the words of the language pack. When the panel is open, the Game Name field is read. The masked value
//! tells the player to click the eye (AGN-04); the expected name posts one observation for the run (AGN-03, AGN-05). Only
//! the match leaves the process, and the span carries whether it matched and whether the field was masked (AGN-07).

use std::num::NonZeroU64;
use std::sync::Arc;

use d2rmm_agent_domain::fusion::{GameNameObservation, fuse};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
use d2rmm_agent_domain::language::{GAME_NAME, LanguagePack, PARTY};
use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::ReadText;

use crate::device_state::DeviceState;
use crate::groups::ReadPorts;
use crate::ports::{ApiGateway, Rgba};
use crate::post_observation;

/// The ports of the Party step: the read and post ports the observation path uses, and the language pack's words.
pub struct PartyPorts<G> {
    pub read: ReadPorts<G>,
    pub language: Arc<LanguagePack>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct RunKey {
    room: String,
    run: NonZeroU64,
    expected: String,
}

impl RunKey {
    fn of(assignment: &Assignment) -> Self {
        Self {
            room: assignment.room.as_str().to_string(),
            run: assignment.run,
            expected: assignment.expected_game_name.as_str().to_string(),
        }
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
            };
        }
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

    /// Claims the one observation of this run. `true` the first time only.
    pub fn claim(&mut self) -> bool {
        if self.posted {
            return false;
        }
        self.posted = true;
        true
    }
}

/// One look at the Party panel of `frame`. Nothing is read without a held assignment, and nothing is posted while the API is
/// not allowed (no token, or a 426 is pending).
pub async fn look<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    frame: &Rgba,
) {
    let assignment = device.assignment.borrow().current().cloned();
    let Some(assignment) = assignment else {
        return;
    };
    if !device.api_allowed() {
        return;
    }
    let Some(observation) = read_panel(device, ports, frame, &assignment) else {
        return;
    };
    post_observation::send(device, &ports.read, &observation).await;
}

/// The synchronous part of the look: reads the panel, updates the run's state and the room view, and returns the observation
/// to post when the field matched and the run had not claimed one yet.
fn read_panel<G>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    frame: &Rgba,
    assignment: &Assignment,
) -> Option<GameNameObservation> {
    let span = tracing::info_span!(
        "agent.vision.read-game-name",
        matched = false,
        masked = false,
    );
    let _entered = span.enter();
    let open = panel_text(ports, frame, PanelRegion::PartyTitle)
        .is_some_and(|title| ports.language.is_word(&title.text, PARTY))
        && panel_text(ports, frame, PanelRegion::GameNameLabel)
            .is_some_and(|label| ports.language.is_word(&label.text, GAME_NAME));
    if !open {
        return None;
    }
    let field = panel_text(ports, frame, PanelRegion::GameNameField)?;
    if field.text.trim().is_empty() {
        // An empty reading says nothing about the field: the state stays as it was.
        return None;
    }
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
                progress.saw_shown();
                progress.claim()
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
fn panel_text<G>(ports: &PartyPorts<G>, frame: &Rgba, panel: PanelRegion) -> Option<ReadText> {
    let region = panel_region(panel, frame.width, frame.height)?;
    ports.read.reader.read(frame, region).ok()
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;

    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::PartyProgress;

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

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

        assert!(progress.claim(), "the first claim is the observation");
        assert!(
            !progress.claim(),
            "a second claim of the same run is refused"
        );
        assert!(progress.matched());
    }

    #[test]
    fn a_new_run_claims_again() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim());

        progress.follow(Some(&assignment(2, "mmbaalh-13")));

        assert!(!progress.matched(), "the new run has not matched");
        assert!(progress.claim(), "the new run posts for itself");
    }

    #[test]
    fn a_repeated_assignment_keeps_the_claim() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim());

        progress.follow(Some(&assignment(1, "mmbaalh-12")));

        assert!(progress.matched(), "the stream repeats the same run");
        assert!(!progress.claim(), "no second observation for it");
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

        assert!(progress.claim());
        assert!(!progress.needs_reveal(), "a match clears the hint");
    }

    #[test]
    fn forgetting_the_assignment_clears_the_run() {
        let mut progress = PartyProgress::default();
        progress.follow(Some(&assignment(1, "mmbaalh-12")));
        assert!(progress.claim());

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
    }

    impl TextReader for Panel {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
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
        look(&rig.device, &rig.ports, &frame(1920, 1033)).await;
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
    async fn an_empty_reading_keeps_the_hint() {
        let rig = rig();
        rig.device
            .replace_assignment(Some(assignment(1, "mmcowsh-1")));
        show(&rig.panel, "PARTY", "xxxxxxxxx");
        look_at(&rig).await;

        show(&rig.panel, "PARTY", "   ");
        look_at(&rig).await;

        assert!(
            room(&rig).is_some_and(|room| room.needs_reveal),
            "no reading says nothing"
        );
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

        look(&rig.device, &rig.ports, &frame(1024, 768)).await;

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
}
