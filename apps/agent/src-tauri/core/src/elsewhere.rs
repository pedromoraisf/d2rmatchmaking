//! The room's elsewhere step (agent-room-lifecycle ARL-08, ARL-09). While the agent holds a run whose presence the API
//! confirmed, each frame's Party panel is read again; a Game Name field that shows another game's name on two looks in a row,
//! and is not a near-miss of the held name (an edit distance above 2), puts the player "in another game": the window says so
//! and one `OTHER_GAME_SEEN` is posted, with no value. The held name read again returns the run to confirmed and posts one
//! `GAME_NAME_SEEN`, as today. The room's stage is the API's and does not change.
//!
//! The other game's name is compared and dropped in the same function that reads it: it is never kept, logged, put in a span
//! or an event, or sent. The step reads the panel through `party::read_panel_with` and changes no reading module.

use std::num::NonZeroU64;
use std::sync::Arc;

use d2rmm_agent_domain::fusion::fuse;
use d2rmm_agent_domain::game_name_match::{
    FieldRead, FieldSource, normalise, read_field, read_panel_field,
};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::name_diff::edit_distance;
use d2rmm_agent_domain::other_game::OtherGameObservation;
use d2rmm_agent_domain::room_assignment::Assignment;
use uuid::Uuid;

use crate::device_state::DeviceState;
use crate::party::{PartyPorts, read_panel_with};
use crate::ports::{ApiGateway, Rgba};
use crate::post_observation::{self, SendOutcome};

/// How many looks in a row must show another game's name (ARL-08).
pub const LOOKS_IN_A_ROW: u8 = 2;

/// A name this far from the held one (in edit operations, after normalising both) is another game's; at this distance or
/// under, it is a misread of the held name (ARL-08).
pub const NEAR_MISS: usize = 2;

/// The fewest characters a reading must have to count as a name: a smaller one is noise (a conservative default).
pub const SHORTEST_NAME: usize = 3;

/// What one look at the Game Name field showed, as a state: never the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Look {
    /// The held name (or a near-miss the reading rules accept as it).
    Held,
    /// A name that is far from the held one.
    Different,
    /// Nothing that settles it: a closed panel, a masked or blank field, a field not located, a near-miss, noise.
    Unclear,
}

/// Classifies the readings of the field against the held name.
pub fn classify(source: FieldSource, reads: &[&str], held: &str) -> Look {
    match read_panel_field(source, reads, held) {
        FieldRead::Matched => Look::Held,
        FieldRead::Masked => Look::Unclear,
        FieldRead::Other => {
            // A field the label did not locate may be any part of the panel: only an exact match counts from it.
            if source == FieldSource::LayoutBox {
                return Look::Unclear;
            }
            let held = normalise(held);
            let readable: Vec<String> = reads
                .iter()
                .map(|read| normalise(read))
                .filter(|read| read.chars().count() >= SHORTEST_NAME)
                .collect();
            let far = !readable.is_empty()
                && readable
                    .iter()
                    .all(|read| edit_distance(read, &held) > NEAR_MISS);
            if far { Look::Different } else { Look::Unclear }
        }
    }
}

/// What a look changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Nothing,
    /// The second look in a row: the player is in another game.
    WentElsewhere,
    /// The held name again after being elsewhere.
    Returned,
}

/// The watch of the held run: how many looks in a row showed another game, and whether the player is elsewhere. Plain
/// counts and flags; it holds no name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Watch {
    run: Option<(String, NonZeroU64)>,
    different_in_a_row: u8,
    elsewhere: bool,
}

impl Watch {
    /// Follows `room` and `run`; another room or run starts over (ARL-04).
    pub fn follow(&mut self, room: &str, run: NonZeroU64) {
        if self
            .run
            .as_ref()
            .is_some_and(|(r, n)| r == room && *n == run)
        {
            return;
        }
        *self = Self {
            run: Some((room.to_string(), run)),
            ..Self::default()
        };
    }

    /// Forgets the run: the room is gone.
    pub fn forget(&mut self) {
        *self = Self::default();
    }

    /// Whether the player is elsewhere for exactly this run.
    pub fn is_elsewhere(&self, room: &str, run: NonZeroU64) -> bool {
        self.elsewhere
            && self
                .run
                .as_ref()
                .is_some_and(|(r, n)| r == room && *n == run)
    }

    /// Takes one look.
    pub fn saw(&mut self, look: Look) -> Step {
        match look {
            Look::Held => {
                self.different_in_a_row = 0;
                if self.elsewhere {
                    self.elsewhere = false;
                    Step::Returned
                } else {
                    Step::Nothing
                }
            }
            Look::Different if self.elsewhere => Step::Nothing,
            Look::Different => {
                self.different_in_a_row = self.different_in_a_row.saturating_add(1);
                if self.different_in_a_row >= LOOKS_IN_A_ROW {
                    self.elsewhere = true;
                    Step::WentElsewhere
                } else {
                    Step::Nothing
                }
            }
            Look::Unclear => {
                self.different_in_a_row = 0;
                Step::Nothing
            }
        }
    }

    /// A post that did not reach the API: the change did not happen, so the next look can make it again.
    pub fn undo(&mut self, step: Step) {
        match step {
            Step::WentElsewhere => {
                self.elsewhere = false;
                self.different_in_a_row = LOOKS_IN_A_ROW - 1;
            }
            Step::Returned => self.elsewhere = true,
            Step::Nothing => {}
        }
    }
}

/// One look at the Party panel of `frame` for the held run, once the API confirmed its presence.
pub async fn look<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    frame: Arc<Rgba>,
) {
    let Some(assignment) = device.assignment.borrow().current().cloned() else {
        device.with_elsewhere(Watch::forget);
        return;
    };
    if !device.api_allowed() || !device.run_confirmed(&assignment) {
        return;
    }
    let (room, run) = (assignment.room.as_str().to_string(), assignment.run);
    device.with_elsewhere(|watch| watch.follow(&room, run));
    let reader = Arc::clone(&ports.read.reader);
    let panel_language = language_with(&ports.language, device);
    let held = assignment.expected_game_name.as_str().to_string();
    let size = (frame.width, frame.height);
    let tracked = device.with_party(|progress| progress.tracked_area(size.0, size.1));
    let regions = device.config.borrow().regions;
    let reading = tokio::task::spawn_blocking(move || {
        let reading = read_panel_with(
            reader.as_ref(),
            &panel_language,
            &frame,
            Some(&held),
            tracked,
            &regions,
        );
        // The name is compared here and goes no further: only the state of the look and the matching read leave.
        let texts: Vec<&str> = reading
            .field
            .iter()
            .map(|read| read.text.as_str())
            .collect();
        let seen = if reading.open {
            classify(reading.field_source, &texts, &held)
        } else {
            Look::Unclear
        };
        let held_read = reading
            .field
            .iter()
            .find(|read| read_field(&read.text, &held) == FieldRead::Matched)
            .cloned();
        (seen, held_read, reading.area)
    })
    .await;
    let Ok((seen, held_read, area)) = reading else {
        return;
    };
    device.with_party(|progress| progress.track_area(area, size.0, size.1));
    let step = device.with_elsewhere(|watch| watch.saw(seen));
    if step == Step::Nothing {
        return;
    }
    device.publish_room();
    match step {
        Step::WentElsewhere => post_elsewhere(device, ports, &assignment, step).await,
        Step::Returned => post_return(device, ports, &assignment, held_read, step).await,
        Step::Nothing => {}
    }
}

/// The pack a look reads with: the shipped pack, or one with the configuration's Party words (RCF-05, RCF-08), as the Party step.
fn language_with(base: &Arc<LanguagePack>, device: &DeviceState) -> Arc<LanguagePack> {
    let phrases = device.config.borrow().phrases.clone();
    if phrases.is_configured() {
        Arc::new(base.with_phrases(&phrases))
    } else {
        Arc::clone(base)
    }
}

async fn post_elsewhere<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    assignment: &Assignment,
    step: Step,
) {
    tracing::info_span!("agent.run.elsewhere").in_scope(|| tracing::info!("agent.run.elsewhere"));
    let Ok(room) = Uuid::parse_str(assignment.room.as_str()) else {
        return;
    };
    let Some(token) = ports.read.tokens.load() else {
        device.with_elsewhere(|watch| watch.undo(step));
        device.publish_room();
        return;
    };
    let observation = OtherGameObservation::of(
        room,
        assignment.run,
        ports.read.ids.idempotency_key(),
        1.0,
        ports.read.clock.now_utc(),
    );
    let posted = ports
        .read
        .gateway
        .post_other_game(&token, &observation)
        .await;
    if let Err(error) = posted {
        device.handle_api_error(&error, ports.read.tokens.as_ref());
        device.with_elsewhere(|watch| watch.undo(step));
        device.publish_room();
    }
}

async fn post_return<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    assignment: &Assignment,
    held_read: Option<d2rmm_agent_domain::vision::ReadText>,
    step: Step,
) {
    tracing::info_span!("agent.run.returned").in_scope(|| tracing::info!("agent.run.returned"));
    let observation = held_read.and_then(|read| {
        fuse(&read, assignment, ports.read.clock.now_utc(), || {
            ports.read.ids.idempotency_key()
        })
    });
    let Some(observation) = observation else {
        device.with_elsewhere(|watch| watch.undo(step));
        device.publish_room();
        return;
    };
    if post_observation::send(device, &ports.read, &observation).await == SendOutcome::Dropped {
        device.with_elsewhere(|watch| watch.undo(step));
        device.publish_room();
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::game_name_match::FieldSource;
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{PanelRegion, panel_region};
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::{Look, Step, Watch, classify, look};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::ReadPorts;
    use crate::party::PartyPorts;
    use crate::ports::{
        ApiError, PausedWallClock, ReadError, Rgba, SequentialIds, TextReader, TokenStore,
    };
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";
    const HELD: &str = "mmbaalh-28";

    fn classify_label(reads: &[&str]) -> Look {
        classify(FieldSource::LabelLine, reads, HELD)
    }

    #[test]
    fn the_held_name_and_its_misreads_are_held_or_unclear_never_different() {
        assert_eq!(classify_label(&["mmbaalh-28"]), Look::Held);
        assert_eq!(classify_label(&["MMBAALH-28 "]), Look::Held);
        // A look-alike glyph, a dropped character and two edits are misreads of the held name.
        for near in [
            "mmbaa1h-28",
            "mmbaalh-2",
            "mmbaalh-29",
            "mmbaaih-28",
            "mbaalh-2",
        ] {
            assert_ne!(classify_label(&[near]), Look::Different, "{near:?}");
        }
    }

    #[test]
    fn a_name_three_edits_away_or_more_is_different() {
        for far in [
            "duels",
            "mmbaalh-300",
            "mmcowsh-28",
            "mmbaxxx-28",
            "baal run",
        ] {
            assert_eq!(classify_label(&[far]), Look::Different, "{far:?}");
        }
        // Exactly three edits away: above the near-miss.
        assert_eq!(classify_label(&["mmbaalh-281"]), Look::Unclear);
        assert_eq!(classify_label(&["mmbaalh-2810"]), Look::Unclear);
        assert_eq!(classify_label(&["mmbaalh-28101"]), Look::Different);
    }

    #[test]
    fn a_variant_that_is_near_keeps_the_look_from_being_different() {
        assert_ne!(classify_label(&["duels", "mmbaalh-2"]), Look::Different);
        assert_eq!(classify_label(&["duels", "chaos run"]), Look::Different);
    }

    #[test]
    fn noise_masks_blanks_and_an_unlocated_field_are_unclear() {
        assert_eq!(classify_label(&[]), Look::Unclear);
        assert_eq!(classify_label(&[""]), Look::Unclear);
        assert_eq!(classify_label(&["  "]), Look::Unclear);
        assert_eq!(classify_label(&["xxxxxxxx"]), Look::Unclear);
        assert_eq!(classify_label(&["ab"]), Look::Unclear);
        assert_eq!(classify_label(&["", "duels"]), Look::Different);
        // From the layout box only an exact match counts (the field was not located).
        assert_eq!(
            classify(FieldSource::LayoutBox, &["duels"], HELD),
            Look::Unclear
        );
        assert_eq!(classify(FieldSource::LayoutBox, &[HELD], HELD), Look::Held);
        assert_eq!(
            classify(FieldSource::Label, &["duels"], HELD),
            Look::Different
        );
    }

    fn run(n: u64) -> NonZeroU64 {
        NonZeroU64::new(n).expect("a non-zero run")
    }

    #[test]
    fn two_different_looks_in_a_row_go_elsewhere_once_and_the_held_name_returns() {
        let mut watch = Watch::default();
        watch.follow(ROOM, run(1));
        assert_eq!(watch.saw(Look::Different), Step::Nothing);
        assert!(!watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(watch.saw(Look::Different), Step::WentElsewhere);
        assert!(watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(
            watch.saw(Look::Different),
            Step::Nothing,
            "one post per change"
        );
        assert_eq!(watch.saw(Look::Unclear), Step::Nothing);
        assert!(
            watch.is_elsewhere(ROOM, run(1)),
            "an unclear look changes nothing"
        );
        assert_eq!(watch.saw(Look::Held), Step::Returned);
        assert!(!watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(watch.saw(Look::Held), Step::Nothing);
    }

    #[test]
    fn a_look_between_breaks_the_row() {
        for between in [Look::Held, Look::Unclear] {
            let mut watch = Watch::default();
            watch.follow(ROOM, run(1));
            assert_eq!(watch.saw(Look::Different), Step::Nothing);
            assert_eq!(watch.saw(between), Step::Nothing);
            assert_eq!(watch.saw(Look::Different), Step::Nothing, "{between:?}");
            assert!(!watch.is_elsewhere(ROOM, run(1)));
        }
    }

    #[test]
    fn a_new_run_or_room_starts_over_and_forget_clears() {
        let mut watch = Watch::default();
        watch.follow(ROOM, run(1));
        watch.saw(Look::Different);
        watch.saw(Look::Different);
        assert!(watch.is_elsewhere(ROOM, run(1)));
        assert!(!watch.is_elsewhere(ROOM, run(2)));
        assert!(!watch.is_elsewhere("another", run(1)));
        watch.follow(ROOM, run(1));
        assert!(
            watch.is_elsewhere(ROOM, run(1)),
            "the same run keeps its state"
        );
        watch.follow(ROOM, run(2));
        assert!(!watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(
            watch.saw(Look::Different),
            Step::Nothing,
            "the row starts over"
        );
        watch.follow(ROOM, run(2));
        watch.saw(Look::Different);
        assert!(watch.is_elsewhere(ROOM, run(2)));
        watch.forget();
        assert!(!watch.is_elsewhere(ROOM, run(2)));
    }

    #[test]
    fn an_undone_step_can_be_made_again() {
        let mut watch = Watch::default();
        watch.follow(ROOM, run(1));
        watch.saw(Look::Different);
        let step = watch.saw(Look::Different);
        watch.undo(step);
        assert!(!watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(watch.saw(Look::Different), Step::WentElsewhere);
        let back = watch.saw(Look::Held);
        watch.undo(back);
        assert!(watch.is_elsewhere(ROOM, run(1)));
        assert_eq!(watch.saw(Look::Held), Step::Returned);
        watch.undo(Step::Nothing);
        assert!(!watch.is_elsewhere(ROOM, run(1)));
    }

    // The step end to end, with the Party panel drawn by a fake reader.

    #[derive(Default)]
    struct Panel {
        title: Mutex<String>,
        field: Mutex<String>,
    }

    impl TextReader for Panel {
        fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
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

        fn read_lines(&self, image: &Rgba, region: Region) -> Vec<TextLine> {
            let at = |panel| panel_region(panel, image.width, image.height);
            let title = self.title.lock().expect("the panel lock").clone();
            let field = self.field.lock().expect("the panel lock").clone();
            [
                (PanelRegion::PartyTitle, title),
                (PanelRegion::GameNameLabel, "Game Name".to_string()),
                (PanelRegion::GameNameField, field),
            ]
            .into_iter()
            .filter_map(|(panel, text)| {
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
        tokens: Arc<MemoryTokens>,
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
        *panel.title.lock().expect("the panel lock") = "PARTY".to_string();
        let ports = PartyPorts {
            read: ReadPorts {
                reader: Arc::clone(&panel) as Arc<dyn TextReader + Send + Sync>,
                ids: Arc::new(SequentialIds::new()),
                clock: Arc::new(PausedWallClock::starting_at(
                    "2026-11-10T10:00:00Z".parse().expect("a valid instant"),
                )),
                gateway: Arc::clone(&gateway),
                tokens: Arc::clone(&tokens) as Arc<dyn TokenStore + Send + Sync>,
            },
            language: Arc::new(LanguagePack::english()),
        };
        Rig {
            device,
            ports,
            gateway,
            panel,
            tokens,
        }
    }

    fn hold(rig: &Rig, run_number: u64, confirmed: bool) {
        rig.device.replace_assignment(Some(Assignment {
            room: RoomId::new(ROOM),
            run: run(run_number),
            expected_game_name: GameName::new(HELD),
            members: Vec::new(),
        }));
        if confirmed {
            rig.device.confirm_run(ROOM, run(run_number));
        }
        rig.device.publish_room();
    }

    fn show(rig: &Rig, field: &str) {
        *rig.panel.field.lock().expect("the panel lock") = field.to_string();
    }

    async fn look_at(rig: &Rig) {
        look(
            &rig.device,
            &rig.ports,
            Arc::new(Rgba {
                width: 1920,
                height: 1033,
                pixels: Vec::new(),
            }),
        )
        .await;
    }

    fn calls(rig: &Rig) -> Vec<Call> {
        rig.gateway.calls()
    }

    fn view(rig: &Rig) -> Option<(bool, bool)> {
        rig.device
            .hub
            .snapshot()
            .room
            .map(|room| (room.confirmed, room.elsewhere))
    }

    #[tokio::test(start_paused = true)]
    async fn another_game_on_two_looks_posts_one_other_game_seen_with_no_name() {
        let rig = rig();
        hold(&rig, 1, true);
        rig.gateway.script_post_other_game([Ok(()), Ok(())]);
        show(&rig, "duels");

        look_at(&rig).await;
        assert_eq!(view(&rig), Some((true, false)), "one look is not enough");
        assert!(calls(&rig).is_empty());
        look_at(&rig).await;
        assert_eq!(
            view(&rig),
            Some((true, true)),
            "the window says another game"
        );
        look_at(&rig).await;
        look_at(&rig).await;

        let posted = calls(&rig);
        assert_eq!(posted.len(), 1, "one post per change: {posted:?}");
        let Call::PostOtherGame(observation) = &posted[0] else {
            panic!("expected an OTHER_GAME_SEEN, got {posted:?}");
        };
        assert_eq!(observation.run, run(1));
        assert_eq!(observation.room.to_string(), ROOM);
        assert!(
            !format!("{posted:?}").contains("duels"),
            "the other name is in no post"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_span_events_carry_no_name() {
        let probe = crate::event_probe::EventProbe::default();
        let _guard = probe.install();
        let rig = rig();
        hold(&rig, 1, true);
        rig.gateway.script_post_other_game([Ok(())]);
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig, "duels");
        look_at(&rig).await;
        look_at(&rig).await;
        show(&rig, HELD);
        look_at(&rig).await;

        assert_eq!(probe.named("agent.run.elsewhere").len(), 1);
        assert_eq!(probe.named("agent.run.returned").len(), 1);
        let everything = format!("{:?}{:?}", probe.events(), probe.spans());
        assert!(!everything.contains("duels"), "{everything}");
    }

    #[tokio::test(start_paused = true)]
    async fn a_misread_of_the_held_name_is_not_another_game() {
        let rig = rig();
        hold(&rig, 1, true);
        show(&rig, "mmbaa1h-28");
        for _ in 0..4 {
            look_at(&rig).await;
        }
        assert!(calls(&rig).is_empty());
        assert_eq!(view(&rig), Some((true, false)));
    }

    #[tokio::test(start_paused = true)]
    async fn the_held_name_again_posts_one_game_name_seen_and_clears_the_line() {
        let rig = rig();
        hold(&rig, 1, true);
        rig.gateway.script_post_other_game([Ok(())]);
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig, "duels");
        look_at(&rig).await;
        look_at(&rig).await;
        show(&rig, "mmbaalh-28");

        look_at(&rig).await;
        look_at(&rig).await;

        let posted = calls(&rig);
        assert_eq!(posted.len(), 2, "{posted:?}");
        assert!(matches!(posted[0], Call::PostOtherGame(_)));
        let Call::PostObservation(back) = &posted[1] else {
            panic!("expected a GAME_NAME_SEEN, got {posted:?}");
        };
        assert_eq!(back.game_name, HELD);
        assert_eq!(view(&rig), Some((true, false)));
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_read_before_the_presence_is_confirmed_or_without_a_room() {
        let rig = rig();
        show(&rig, "duels");
        look_at(&rig).await;
        look_at(&rig).await;
        hold(&rig, 1, false);
        look_at(&rig).await;
        look_at(&rig).await;
        assert!(calls(&rig).is_empty());
        assert_eq!(view(&rig), Some((false, false)));
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_run_and_a_dropped_room_clear_the_line() {
        let rig = rig();
        hold(&rig, 1, true);
        rig.gateway.script_post_other_game([Ok(())]);
        show(&rig, "duels");
        look_at(&rig).await;
        look_at(&rig).await;
        assert_eq!(view(&rig), Some((true, true)));

        hold(&rig, 2, false);
        assert_eq!(
            view(&rig),
            Some((false, false)),
            "a new run is not confirmed yet"
        );

        hold(&rig, 1, true);
        assert_eq!(
            view(&rig),
            Some((true, true)),
            "the same run, still elsewhere"
        );
        rig.device.replace_assignment(None);
        rig.device.publish_room();
        assert_eq!(view(&rig), None);
        hold(&rig, 1, true);
        assert_eq!(view(&rig), Some((true, false)), "a dropped room forgot it");
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_post_leaves_the_player_able_to_post_again_on_the_next_look() {
        let rig = rig();
        hold(&rig, 1, true);
        rig.gateway
            .script_post_other_game([Err(ApiError::Network), Ok(())]);
        show(&rig, "duels");
        look_at(&rig).await;
        look_at(&rig).await;
        assert_eq!(
            view(&rig),
            Some((true, false)),
            "the post did not reach the API"
        );
        look_at(&rig).await;
        assert_eq!(view(&rig), Some((true, true)));
        assert_eq!(calls(&rig).len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn the_post_needs_the_token_and_the_closed_panel_is_not_a_look() {
        let rig = rig();
        hold(&rig, 1, true);
        show(&rig, "duels");
        *rig.panel.title.lock().expect("the panel lock") = String::new();
        for _ in 0..3 {
            look_at(&rig).await;
        }
        assert_eq!(
            view(&rig),
            Some((true, false)),
            "a closed panel shows nothing"
        );
        *rig.panel.title.lock().expect("the panel lock") = "PARTY".to_string();
        rig.tokens.delete();
        look_at(&rig).await;
        look_at(&rig).await;
        assert!(calls(&rig).is_empty());
    }
}
