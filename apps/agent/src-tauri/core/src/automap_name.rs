//! The automap step (design.md § The automap source; GNR-06). The automap shows the room's game name in the top-right text
//! column, on one line with its label. While the Party step has not matched the held run, each captured frame's top-right
//! band is read, the line that has the shape of a generated name is found (`anchors::find_name_line`), and the name goes
//! through the same match as the Party field: only the expected name, after the glyph table, posts one observation for the
//! run. The run is claimed once (`PartyProgress::claim`), so whichever source reads it first posts, and the other never
//! posts again. Only the match leaves the process; the span and the counter carry fixed words, never a name or a text (GNR-10).
//! The OCR runs on a blocking thread.

use std::sync::Arc;

use d2rmm_agent_domain::anchors;
use d2rmm_agent_domain::fusion::{GameNameObservation, fuse};
use d2rmm_agent_domain::game_name_match::{FieldRead, read_field};
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
use d2rmm_agent_domain::room_assignment::Assignment;
use d2rmm_agent_domain::vision::{ReadText, TextLine};

use crate::device_state::DeviceState;
use crate::party::{PartyPorts, RunKey};
use crate::ports::{ApiGateway, Rgba};
use crate::post_observation;

/// The confidence of a name read from a line of the band. The reader gives no confidence per line, and the observation is
/// posted only after an exact match through the glyph table, so the read is as sure as that match.
const LINE_CONFIDENCE: f64 = 1.0;

/// What the name line of one frame says about the room's name, as a state and never as the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameRead {
    /// No line of the band has the shape of a name.
    NoName,
    /// A line shows the expected name, after the glyph table.
    Matched,
    /// The lines show names, none the expected one.
    Other,
}

impl NameRead {
    /// The fixed word the counter carries (`outcome`): never a name.
    pub fn word(self) -> &'static str {
        match self {
            Self::NoName => "none",
            Self::Matched => "matched",
            Self::Other => "other",
        }
    }
}

/// Whether any of the names the band's lines showed is `expected`. The match is `read_field`'s (a glyph table, never an edit
/// distance), so another room's name stays refused.
pub fn name_read(names: &[ReadText], expected: &str) -> NameRead {
    if names.is_empty() {
        return NameRead::NoName;
    }
    if names
        .iter()
        .any(|name| read_field(&name.text, expected) == FieldRead::Matched)
    {
        NameRead::Matched
    } else {
        NameRead::Other
    }
}

/// The names the band's lines show, one per OCR variant that found one, as readings.
pub fn names_of(variants: &[Vec<TextLine>]) -> Vec<ReadText> {
    anchors::find_name_line_in_variants(variants)
        .into_iter()
        .map(|line| ReadText {
            text: line.text,
            confidence: LINE_CONFIDENCE,
        })
        .collect()
}

/// One look at the automap's name band of `frame`. Nothing is read without a held assignment, nothing is read once the run
/// has matched (by this step or the Party step), and nothing is posted while the API is not allowed.
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
    let Some(area) = screen_region(ScreenRegion::AutomapName, frame.width, frame.height) else {
        return;
    };
    let reader = Arc::clone(&ports.read.reader);
    let lines = tokio::task::spawn_blocking(move || reader.read_line_variants(&frame, area)).await;
    let Ok(lines) = lines else {
        return;
    };
    let Some(observation) = apply_reading(device, ports, &assignment, &lines) else {
        return;
    };
    post_observation::send(device, &ports.read, &observation).await;
}

/// The synchronous part of the look: the observation to post when a line showed the expected name and the run had not been
/// claimed yet.
fn apply_reading<G>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    assignment: &Assignment,
    lines: &[Vec<TextLine>],
) -> Option<GameNameObservation> {
    let span = tracing::info_span!("agent.vision.read-automap-name", matched = false);
    let _entered = span.enter();
    let names = names_of(lines);
    let expected = assignment.expected_game_name.as_str();
    let read = name_read(&names, expected);
    if read != NameRead::NoName {
        tracing::info!(
            source = "automap",
            outcome = read.word(),
            "agent.vision.name_reads"
        );
    }
    if read != NameRead::Matched {
        return None;
    }
    span.record("matched", true);
    let run = RunKey::of(assignment);
    let claimed = device.with_party(|progress| progress.claim(&run));
    device.publish_room();
    if !claimed {
        return None;
    }
    let now = ports.read.clock.now_utc();
    // The line that matched is the reading the observation carries.
    let name = names
        .iter()
        .find(|name| read_field(&name.text, expected) == FieldRead::Matched)?;
    fuse(name, assignment, now, || ports.read.ids.idempotency_key())
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::fusion::GameNameObservation;
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::{NameRead, look, name_read, names_of};
    use crate::device_state::DeviceState;
    use crate::event_probe::EventProbe;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::ReadPorts;
    use crate::party::{PartyPorts, RunKey};
    use crate::ports::{
        ApiError, PausedWallClock, ReadError, Rgba, SequentialIds, TextReader, TokenStore,
    };
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    /// A reader whose frame shows some lines at their boxes: a region answers the lines whose middle it holds. Reads are counted.
    #[derive(Default)]
    struct Column {
        lines: Mutex<Vec<TextLine>>,
        reads: AtomicUsize,
    }

    impl TextReader for Column {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::Failed)
        }

        fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.lines
                .lock()
                .expect("the column lock")
                .iter()
                .filter(|line| {
                    let (x, y) = (line.region.middle_x(), line.region.middle_y());
                    region.x <= x && x < region.right() && region.y <= y && y < region.bottom()
                })
                .cloned()
                .collect()
        }
    }

    struct Rig {
        device: DeviceState,
        ports: PartyPorts<FakeApiGateway>,
        gateway: Arc<FakeApiGateway>,
        column: Arc<Column>,
    }

    fn rig() -> Rig {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let column = Arc::new(Column::default());
        let ports = PartyPorts {
            read: ReadPorts {
                reader: Arc::clone(&column) as Arc<dyn TextReader + Send + Sync>,
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
            column,
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

    /// Shows one line at the measured box of the English print (1920x1033: x 1735, y 34, 155x13).
    fn show(column: &Column, text: &str) {
        show_at(column, text, 1735, 34);
    }

    fn show_at(column: &Column, text: &str, x: u32, y: u32) {
        *column.lines.lock().expect("the column lock") = vec![TextLine {
            text: text.to_string(),
            region: Region {
                x,
                y,
                width: 155,
                height: 13,
            },
        }];
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

    fn held(rig: &Rig, name: &str) {
        rig.device.replace_assignment(Some(assignment(1, name)));
    }

    #[tokio::test(start_paused = true)]
    async fn the_expected_name_on_the_automap_posts_once_per_run() {
        let rig = rig();
        held(&rig, "mmcowsh-1");
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.column, "Game: MMC⊕WSH-1");

        look_at(&rig).await;
        look_at(&rig).await;

        let posted = posts(&rig.gateway);
        assert_eq!(posted.len(), 1, "one observation for the run");
        assert_eq!(posted[0].game_name, "mmcowsh-1", "the expected name");
        assert_eq!(posted[0].run.get(), 1);
        assert!(
            rig.device
                .hub
                .snapshot()
                .room
                .is_some_and(|room| room.matched),
            "the room shows the match"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_name_alone_on_its_line_posts_too() {
        let rig = rig();
        held(&rig, "mmbaalh-19");
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.column, "mmbaalh-19");

        look_at(&rig).await;

        assert_eq!(posts(&rig.gateway).len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn another_name_or_another_code_posts_nothing() {
        for shown in ["Game: mmbaalh-999", "Game: mmbaaln-19", "Game: mmbaalm-19"] {
            let rig = rig();
            held(&rig, "mmbaalh-19");
            show(&rig.column, shown);

            look_at(&rig).await;

            assert!(posts(&rig.gateway).is_empty(), "{shown}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_column_with_no_name_posts_nothing() {
        let rig = rig();
        held(&rig, "mmbaalh-19");
        show(&rig.column, "Difficulty: Hell");

        look_at(&rig).await;

        assert!(posts(&rig.gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_run_the_party_step_confirmed_is_not_read_or_posted_again() {
        let rig = rig();
        let held_run = assignment(1, "mmcowsh-1");
        rig.device.replace_assignment(Some(held_run.clone()));
        assert!(
            rig.device
                .with_party(|progress| progress.claim(&RunKey::of(&held_run))),
            "the Party step claims the run"
        );
        show(&rig.column, "Game: mmcowsh-1");

        look_at(&rig).await;

        assert!(posts(&rig.gateway).is_empty(), "claimed once, by the Party");
        assert_eq!(rig.column.reads.load(Ordering::SeqCst), 0, "not read");
    }

    #[tokio::test(start_paused = true)]
    async fn the_party_step_does_not_post_again_after_the_automap_did() {
        let rig = rig();
        let held_run = assignment(1, "mmcowsh-1");
        rig.device.replace_assignment(Some(held_run.clone()));
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.column, "Game: mmcowsh-1");

        look_at(&rig).await;

        assert!(
            !rig.device
                .with_party(|progress| progress.claim(&RunKey::of(&held_run))),
            "the automap claimed the run, so the Party step cannot"
        );
        assert_eq!(posts(&rig.gateway).len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_read_without_an_assignment_or_while_the_api_is_not_allowed() {
        let rig = rig();
        show(&rig.column, "Game: mmcowsh-1");
        look_at(&rig).await;
        assert_eq!(rig.column.reads.load(Ordering::SeqCst), 0, "no assignment");

        held(&rig, "mmcowsh-1");
        rig.device.set_paired(false);
        look_at(&rig).await;
        assert_eq!(rig.column.reads.load(Ordering::SeqCst), 0, "not paired");
        assert!(posts(&rig.gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_frame_of_an_unsupported_size_reads_nothing() {
        let rig = rig();
        held(&rig, "mmcowsh-1");
        show(&rig.column, "Game: mmcowsh-1");

        look(&rig.device, &rig.ports, Arc::new(frame(1280, 1024))).await;

        assert_eq!(rig.column.reads.load(Ordering::SeqCst), 0);
        assert!(posts(&rig.gateway).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_line_outside_the_band_is_not_read() {
        let rig = rig();
        held(&rig, "mmcowsh-1");
        // 12% of 1033 is 124 px: this line is below the band; and this one is left of it.
        show_at(&rig.column, "Game: mmcowsh-1", 1735, 300);
        look_at(&rig).await;
        show_at(&rig.column, "Game: mmcowsh-1", 900, 34);
        look_at(&rig).await;

        assert!(posts(&rig.gateway).is_empty());
        let band = screen_region(ScreenRegion::AutomapName, 1920, 1033).expect("the band");
        assert_eq!((band.x, band.y, band.bottom()), (1632, 0, 124));
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_post_retries_with_the_same_key_as_the_party_step_does() {
        let rig = rig();
        held(&rig, "mmcowsh-1");
        rig.gateway
            .script_post_observation([Err(ApiError::Network), Ok(())]);
        show(&rig.column, "Game: mmcowsh-1");

        look_at(&rig).await;

        let posted = posts(&rig.gateway);
        assert_eq!(posted.len(), 2, "one failure, one retry");
        assert_eq!(posted[0].key, posted[1].key, "the retry keeps its key");
        assert_eq!(rig.device.dropped_observations(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_run_posts_again() {
        let rig = rig();
        held(&rig, "mmcowsh-1");
        rig.gateway.script_post_observation([Ok(()), Ok(())]);
        show(&rig.column, "Game: mmcowsh-1");
        look_at(&rig).await;

        rig.device
            .replace_assignment(Some(assignment(2, "mmcowsh-1")));
        look_at(&rig).await;

        let runs: Vec<u64> = posts(&rig.gateway).iter().map(|o| o.run.get()).collect();
        assert_eq!(runs, [1, 2]);
    }

    #[test]
    fn the_read_of_the_names_is_a_state() {
        let read = |text: &str| ReadText {
            text: text.to_string(),
            confidence: 1.0,
        };
        assert_eq!(name_read(&[], "mmcowsh-1"), NameRead::NoName);
        assert_eq!(
            name_read(&[read("mmcowsh-1")], "mmcowsh-1"),
            NameRead::Matched
        );
        assert_eq!(
            name_read(&[read("mmcowsh-2"), read("MMC0WSH-1")], "mmcowsh-1"),
            NameRead::Matched,
            "any variant"
        );
        assert_eq!(
            name_read(&[read("mmcowsh-2")], "mmcowsh-1"),
            NameRead::Other
        );
        for (state, word) in [
            (NameRead::NoName, "none"),
            (NameRead::Matched, "matched"),
            (NameRead::Other, "other"),
        ] {
            assert_eq!(state.word(), word);
        }
        assert!(names_of(&[vec![], vec![]]).is_empty());
    }

    /// The counter's events of one scenario: a mismatch and then the match, read with a recording subscriber. A subscriber
    /// installed for a thread shares tracing's process-wide callsite cache with the tests that run beside it (`cargo test`
    /// runs them in one process), which can hide an event; the scenario runs again on a fresh rig, up to a bound, until the
    /// cache lets its events through. The assertion on the words, and on the absence of a name, holds on every attempt.
    async fn counted_outcomes() -> Vec<(String, String)> {
        let probe = EventProbe::default();
        let _guard = probe.install();
        let rig = rig();
        held(&rig, "mmcowsh-1");
        rig.gateway.script_post_observation([Ok(())]);
        show(&rig.column, "Game: mmcowsh-7");
        tracing::callsite::rebuild_interest_cache();
        look_at(&rig).await;
        show(&rig.column, "Game: mmcowsh-1");
        tracing::callsite::rebuild_interest_cache();
        look_at(&rig).await;

        for event in probe.events() {
            for (key, value) in &event.fields {
                assert!(
                    !value.contains("mmcowsh") && !value.contains("MMC"),
                    "{key} holds a name"
                );
            }
            assert!(!event.message.contains("mmcowsh"));
        }
        probe
            .named("agent.vision.name_reads")
            .iter()
            .map(|event| {
                let word = |key: &str| {
                    event
                        .fields
                        .get(key)
                        .map_or(String::new(), |v| v.trim_matches('"').to_string())
                };
                (word("source"), word("outcome"))
            })
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn the_counter_carries_fixed_words_and_no_name() {
        let expected = vec![
            ("automap".to_string(), "other".to_string()),
            ("automap".to_string(), "matched".to_string()),
        ];
        let mut seen = Vec::new();
        for _attempt in 0..40 {
            seen = counted_outcomes().await;
            if seen == expected {
                break;
            }
        }
        assert_eq!(seen, expected);
    }
}
