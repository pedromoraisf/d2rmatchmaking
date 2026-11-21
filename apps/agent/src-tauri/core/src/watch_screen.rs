//! The screen loop (design.md § Agent; CHR-01 to CHR-06). Once a second the agent asks whether the player has consented and
//! whether the game runs; only then does it capture the game window in memory, read the screen the frame shows and, on the
//! character selection screen, send the complete cards it read. Nothing captured leaves the process (ADR 010, NFR-04). The
//! screen is shared with the heartbeat, which beats at once when it changes (CHR-04, CHR-05).

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::characters::{Card, reconcile_names};
use d2rmm_agent_domain::frame_content::{FrameContent, summarize};
use d2rmm_agent_domain::presence::game_running;

use crate::automap_name;
use crate::chat_step;
use crate::device_state::DeviceState;
use crate::messages::{CaptureReport, FrameReading, Screen};
use crate::party::{self, PartyLook, PartyPorts};
use crate::ports::{
    ApiError, ApiGateway, CaptureStatus, ConsentStore, FrameReader, FrameSource, ProcessSource,
    Rgba, TokenStore,
};
use crate::view::{CaptureView, DiagnosticsView, FieldDetailView, PartyLookView, RejectedSlot};

/// The interval between two looks at the game (CHR-03: at most once per second).
pub const TICK: Duration = Duration::from_secs(1);

/// The ports the screen loop uses (AHM-17): five trait objects and the gateway, and the Party step's group (AGN-01).
pub struct ScreenPorts<G> {
    pub gateway: Arc<G>,
    pub tokens: Arc<dyn TokenStore + Send + Sync>,
    pub processes: Arc<dyn ProcessSource + Send + Sync>,
    pub frames: Arc<dyn FrameSource + Send + Sync>,
    pub reader: Arc<dyn FrameReader + Send + Sync>,
    pub consent: Arc<dyn ConsentStore + Send + Sync>,
    pub party: PartyPorts<G>,
}

/// Looks at the game for the life of the agent, one tick at a time.
pub async fn run<G: ApiGateway + Send + Sync + 'static>(
    device: Arc<DeviceState>,
    ports: ScreenPorts<G>,
) {
    let mut posted = None;
    loop {
        tick(&device, &ports, &mut posted).await;
        tokio::time::sleep(TICK).await;
    }
}

/// One look at the game. `posted` is the card set the API last accepted; cards are sent only when the set differs from it.
pub async fn tick<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ScreenPorts<G>,
    posted: &mut Option<Vec<Card>>,
) {
    let Some(frame) = capture(ports) else {
        show_nothing_read(device);
        let status = ports.frames.status();
        device.set_capture_report(report_of(status));
        // The window's size is looked up only when the game runs and gave nothing to read: not once a second while it is gone.
        let window = if status.unusable {
            ports.frames.window_size()
        } else {
            None
        };
        device.hub.set_capture(unseen_capture(status, window));
        return;
    };
    let status = ports.frames.status();
    // A source that already measured the frame (the `Capturer` does, to accept it) hands the measure over: it is taken once.
    let content = status.content.unwrap_or_else(|| summarize(&frame.pixels));
    device.set_capture_report(report_of(status));
    if content.blank {
        // A blank frame is never read: no OCR call is made for it, and the Party step does not see it (CAP-02, NFR-02).
        show_nothing_read(device);
        device.hub.set_capture(CaptureView {
            reason: Some(NOTHING_SEEN),
            ..capture_of(
                content,
                ports.frames.window_size(),
                None,
                ports.frames.status(),
            )
        });
        return;
    }
    let frame = Arc::new(frame);
    let reading = read_screen(ports, &frame).await;
    device.set_screen(reading.screen);
    party::look(device, &ports.party, Arc::clone(&frame)).await;
    // The automap's name line and the chat's joined and left lines (game-name-reading), at most once a tick like the Party step.
    automap_name::look(device, &ports.party, Arc::clone(&frame)).await;
    chat_step::look(device, &ports.party, Arc::clone(&frame)).await;
    device.hub.set_capture(capture_of(
        content,
        ports.frames.window_size(),
        device
            .party_look_describes_screen()
            .then(|| device.with_party(|progress| progress.last_look()))
            .flatten(),
        status,
    ));
    let mut diagnostics = diagnostics_of(&reading, &frame, previous_post(device));
    let FrameReading {
        screen: Screen::CharacterSelect,
        cards,
        ..
    } = reading
    else {
        device.hub.set_diagnostics(diagnostics);
        return;
    };
    // A name the screen misread (I, l and 1 are one glyph to it) keeps the spelling the account already has (CHR-10).
    let cards = in_name_order(reconcile_names(cards, posted.as_deref().unwrap_or(&[])));
    // The API takes 1 to 24 cards; an empty reading sends nothing, and a set the API already has is not sent again.
    if cards.is_empty() || posted.as_ref() == Some(&cards) || !device.api_allowed() {
        device.hub.set_diagnostics(diagnostics);
        return;
    }
    let Some(token) = ports.tokens.load() else {
        device.hub.set_diagnostics(diagnostics);
        return;
    };
    let answer = ports.gateway.post_characters(&token, &cards).await;
    diagnostics.post = match &answer {
        Ok(()) => POST_OK,
        Err(error) => error_kind(error),
    };
    device.hub.set_diagnostics(diagnostics);
    match answer {
        Ok(()) => *posted = Some(cards),
        Err(error @ (ApiError::Unauthorized | ApiError::UpgradeRequired)) => {
            device.handle_api_error(&error, ports.tokens.as_ref());
        }
        // Any other failure keeps the set unsent, so the next tick sends it again.
        Err(_) => {}
    }
}

/// A look that read nothing: the screen is reported as `Unknown` and the diagnostics say the same, with no cards from an
/// earlier frame. One value feeds the heartbeat and the window, so they never disagree (ARL-06, CHR-04).
fn show_nothing_read(device: &DeviceState) {
    device.set_screen(Screen::Unknown);
    if let Some(shown) = device.hub.snapshot().diagnostics {
        device.hub.set_diagnostics(DiagnosticsView {
            screen: screen_code(Screen::Unknown),
            cards_read: 0,
            cards_settled: 0,
            popup_options_found: 0,
            rejected: Vec::new(),
            ..shown
        });
    }
}

const POST_NOT_SENT: &str = "not-sent";
const POST_OK: &str = "ok";

/// The outcome of the last post, kept while no new post is made.
fn previous_post(device: &DeviceState) -> &'static str {
    device
        .hub
        .snapshot()
        .diagnostics
        .map_or(POST_NOT_SENT, |diagnostics| diagnostics.post)
}

/// The kind of an error, as a short code. No status line, body, header or URL: `ApiError` carries none.
fn error_kind(error: &ApiError) -> &'static str {
    match error {
        ApiError::Unauthorized => "unauthorized",
        ApiError::UpgradeRequired => "upgrade-required",
        ApiError::RateLimited { .. } => "rate-limited",
        ApiError::Gone => "gone",
        ApiError::Pending => "pending",
        ApiError::Server => "server",
        ApiError::Network => "network",
        ApiError::Invalid => "invalid",
        ApiError::CheckEnded => "check-ended",
    }
}

fn screen_code(screen: Screen) -> &'static str {
    match screen {
        Screen::Unknown => "unknown",
        Screen::CharacterSelect => "characterSelect",
        Screen::InGame => "inGame",
        Screen::AutomapOpen => "automapOpen",
    }
}

/// What the window shows of one read: counts, the frame size and reason codes, never a name or a line of text.
fn diagnostics_of(reading: &FrameReading, frame: &Rgba, post: &'static str) -> DiagnosticsView {
    DiagnosticsView {
        screen: screen_code(reading.screen),
        frame_width: frame.width,
        frame_height: frame.height,
        cards_read: reading.slots_read,
        cards_settled: u8::try_from(reading.cards.len()).unwrap_or(u8::MAX),
        popup_options_found: reading.popup_options,
        rejected: reading
            .rejected
            .iter()
            .map(|rejection| RejectedSlot {
                slot: rejection.slot,
                reason: rejection.reason.code(),
            })
            .collect(),
        post,
    }
}

/// What the capture itself shows: the frame's brightness, the window's size and the last Party look. Numbers and booleans.
fn capture_of(
    content: FrameContent,
    window: Option<(u32, u32)>,
    party: Option<PartyLook>,
    status: CaptureStatus,
) -> CaptureView {
    CaptureView {
        method: method_word(status),
        read_rate_percent: status.read_rate_percent,
        reason: None,
        brightness: content.brightness,
        blank: content.blank,
        window_width: window.map(|(width, _)| width),
        window_height: window.map(|(_, height)| height),
        party: party.map(|look| PartyLookView {
            panel_open: look.panel_open,
            field: look.field.code(),
            matched: look.matched,
            detail: look.detail.map(|detail| FieldDetailView {
                source: detail.source,
                variants: detail.variants,
                diff: detail.diff,
            }),
        }),
    }
}

/// What the window shows when a look gave no frame: no brightness, the capture's status, and `nothing` as the reason when the
/// game runs and no method gave a usable frame (CAP-02). A look that was not allowed shows no reason.
fn unseen_capture(status: CaptureStatus, window: Option<(u32, u32)>) -> CaptureView {
    CaptureView {
        brightness: 0,
        blank: status.unusable,
        window_width: window.map(|(width, _)| width),
        window_height: window.map(|(_, height)| height),
        party: None,
        method: method_word(status),
        read_rate_percent: status.read_rate_percent,
        reason: status.unusable.then_some(NOTHING_SEEN),
    }
}

/// The reason code of a look that gave no usable frame while the game ran.
const NOTHING_SEEN: &str = "nothing";

/// What the heartbeat reports of a capture status (CAP-07).
fn report_of(status: CaptureStatus) -> CaptureReport {
    CaptureReport {
        method: status.method,
        read_rate_percent: status.read_rate_percent,
    }
}

fn method_word(status: CaptureStatus) -> &'static str {
    status.method.map_or("none", |method| method.word())
}

/// The game window's frame, when the player has consented, the game runs and a frame came. `None` otherwise: in each case
/// nothing is captured past the check that failed (CHR-01, CHR-02, CHR-03).
fn capture<G>(ports: &ScreenPorts<G>) -> Option<Rgba> {
    if !ports.consent.load() || !game_running(&ports.processes.names()) {
        // No capture session stays open without consent or a game (CAP-05).
        ports.frames.release();
        return None;
    }
    ports.frames.capture()
}

/// What the frame shows: its screen, and its cards on the character selection screen. The OCR runs on a blocking thread, as
/// the Party step's does, so a read never holds the async worker. The reader reads the card regions only for the selection
/// screen (`domain::character_screen::read_screen`). A reader that panics shows nothing (`Unknown`).
async fn read_screen<G>(ports: &ScreenPorts<G>, frame: &Arc<Rgba>) -> FrameReading {
    let span = tracing::info_span!(
        "agent.vision.read-characters",
        screen = tracing::field::Empty,
        cards = tracing::field::Empty,
    );
    let reader = Arc::clone(&ports.reader);
    let frame = Arc::clone(frame);
    let reading = tokio::task::spawn_blocking(move || reader.read(&frame))
        .await
        .unwrap_or_else(|_| FrameReading::without_cards(Screen::Unknown));
    span.record("screen", tracing::field::debug(&reading.screen));
    span.record("cards", reading.cards.len());
    reading
}

fn in_name_order(mut cards: Vec<Card>) -> Vec<Card> {
    cards.sort_by(|left, right| left.name().cmp(right.name()));
    cards
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use d2rmm_agent_domain::capture_cascade::CaptureMethod;
    use d2rmm_agent_domain::characters::{Card, Class, Mode, Title};

    use d2rmm_agent_domain::character_screen::{RejectReason, Rejection};

    use super::{ScreenPorts, capture_of, tick, unseen_capture};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NoText, NullSink};
    use crate::groups::ReadPorts;
    use crate::messages::{CaptureReport, FrameReading, Screen};
    use crate::party::{FieldDetail, FieldState, PartyLook, PartyPorts};
    use crate::ports::{
        ApiError, CaptureStatus, ConsentStore, FrameReader, FrameSource, PausedWallClock,
        ProcessSource, ReadError, Rgba, SequentialIds, StoreError, TextReader, TokenStore,
    };
    use crate::secret::Secret;
    use crate::view::{CaptureView, DiagnosticsView, FieldDetailView, PartyLookView, RejectedSlot};
    use d2rmm_agent_domain::frame_content::summarize;
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::vision::{ReadText, Region};

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    /// A frame source that counts every capture; it holds a frame or none (a minimized window).
    struct Frames {
        frame: Option<Rgba>,
        captures: AtomicUsize,
    }

    impl FrameSource for Frames {
        fn capture(&self) -> Option<Rgba> {
            self.captures.fetch_add(1, Ordering::SeqCst);
            self.frame.clone()
        }
    }

    /// A reader that answers one reading and counts the frames it read.
    struct Reader {
        reading: Mutex<FrameReading>,
        reads: AtomicUsize,
    }

    impl FrameReader for Reader {
        fn read(&self, _frame: &Rgba) -> FrameReading {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.reading.lock().expect("the reading lock").clone()
        }
    }

    /// The consent flag, held in memory.
    struct Consent(AtomicBool);

    impl ConsentStore for Consent {
        fn load(&self) -> bool {
            self.0.load(Ordering::SeqCst)
        }

        fn save(&self, consent: bool) -> Result<(), StoreError> {
            self.0.store(consent, Ordering::SeqCst);
            Ok(())
        }
    }

    /// A process snapshot: the game runs, or it does not.
    struct Processes {
        game: bool,
    }

    impl ProcessSource for Processes {
        fn names(&self) -> Vec<String> {
            if self.game {
                vec!["D2R.exe".to_string()]
            } else {
                Vec::new()
            }
        }
    }

    struct Rig {
        device: DeviceState,
        ports: ScreenPorts<FakeApiGateway>,
        gateway: Arc<FakeApiGateway>,
        frames: Arc<Frames>,
        reader: Arc<Reader>,
        consent: Arc<Consent>,
        tokens: Arc<MemoryTokens>,
    }

    fn card(name: &str) -> Card {
        Card::new(
            name,
            Class::Sorceress,
            85,
            Mode::Softcore,
            Some(Title::Lord),
        )
        .expect("the card builds")
    }

    fn rig(consent: bool, game: bool, frame: Option<Rgba>, reading: FrameReading) -> Rig {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let frames = Arc::new(Frames {
            frame,
            captures: AtomicUsize::new(0),
        });
        let reader = Arc::new(Reader {
            reading: Mutex::new(reading),
            reads: AtomicUsize::new(0),
        });
        let consent = Arc::new(Consent(AtomicBool::new(consent)));
        let ports = ScreenPorts {
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens) as Arc<dyn TokenStore + Send + Sync>,
            processes: Arc::new(Processes { game }),
            frames: Arc::clone(&frames) as Arc<dyn FrameSource + Send + Sync>,
            reader: Arc::clone(&reader) as Arc<dyn FrameReader + Send + Sync>,
            consent: Arc::clone(&consent) as Arc<dyn ConsentStore + Send + Sync>,
            party: PartyPorts {
                read: ReadPorts {
                    reader: Arc::new(NoText),
                    ids: Arc::new(SequentialIds::new()),
                    clock: Arc::new(PausedWallClock::starting_at(
                        "2026-11-10T10:00:00Z".parse().expect("a valid instant"),
                    )),
                    gateway: Arc::clone(&gateway),
                    tokens: Arc::clone(&tokens) as Arc<dyn TokenStore + Send + Sync>,
                },
                language: Arc::new(LanguagePack::english()),
            },
        };
        Rig {
            device,
            ports,
            gateway,
            frames,
            reader,
            consent,
            tokens,
        }
    }

    /// A frame with something drawn on it. It says it is 1920×1080 and holds a few hundred drawn pixels: the fake reader
    /// never looks at them, and `summarize` samples them, so the frame is neither blank nor eight megabytes.
    fn frame() -> Option<Rgba> {
        let mut pixels = Vec::new();
        for at in 0..512_u32 {
            let value = u8::try_from(40 + at % 150).expect("a byte");
            pixels.extend_from_slice(&[value, value, value, 255]);
        }
        Some(Rgba {
            width: 1920,
            height: 1080,
            pixels,
        })
    }

    /// A frame with no pixels drawn: a blank capture.
    fn blank_frame() -> Option<Rgba> {
        Some(Rgba {
            width: 1920,
            height: 1080,
            pixels: vec![0; 2048],
        })
    }

    fn selecting(cards: Vec<Card>) -> FrameReading {
        FrameReading {
            screen: Screen::CharacterSelect,
            slots_read: u8::try_from(cards.len()).expect("a few cards"),
            popup_options: 0,
            rejected: Vec::new(),
            cards,
        }
    }

    fn posts(gateway: &FakeApiGateway) -> Vec<Call> {
        gateway
            .calls()
            .into_iter()
            .filter(|call| matches!(call, Call::PostCharacters { .. }))
            .collect()
    }

    async fn look(rig: &Rig, posted: &mut Option<Vec<Card>>) {
        tick(&rig.device, &rig.ports, posted).await;
    }

    #[tokio::test]
    async fn without_consent_nothing_is_captured_or_read_and_the_screen_is_unknown() {
        let rig = rig(false, true, frame(), selecting(vec![card("Sorc")]));
        rig.device.set_screen(Screen::CharacterSelect);

        look(&rig, &mut None).await;

        assert_eq!(
            rig.frames.captures.load(Ordering::SeqCst),
            0,
            "no capture without consent"
        );
        assert_eq!(
            rig.reader.reads.load(Ordering::SeqCst),
            0,
            "no read without consent"
        );
        assert_eq!(rig.device.screen.borrow().clone(), Screen::Unknown);
        assert!(
            rig.gateway.calls().is_empty(),
            "nothing is sent without consent"
        );
    }

    #[tokio::test]
    async fn consent_reads_the_character_select_screen_and_posts_its_cards_once() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        rig.gateway.script_post_characters([Ok(())]);
        let mut posted = None;

        look(&rig, &mut posted).await;
        look(&rig, &mut posted).await;

        assert_eq!(*rig.device.screen.borrow(), Screen::CharacterSelect);
        assert_eq!(
            posts(&rig.gateway),
            vec![Call::PostCharacters {
                cards: vec![card("Sorc")],
            }],
            "the same card set is sent once"
        );
    }

    #[tokio::test]
    async fn a_changed_card_set_is_sent_again() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        rig.gateway.script_post_characters([Ok(()), Ok(())]);
        let mut posted = None;
        look(&rig, &mut posted).await;

        *rig.reader.reading.lock().expect("the reading lock") =
            selecting(vec![card("Sorc"), card("Hammer")]);
        look(&rig, &mut posted).await;

        assert_eq!(posts(&rig.gateway).len(), 2, "the new card set is sent");
    }

    #[tokio::test]
    async fn a_misread_name_of_a_posted_character_keeps_the_posted_spelling() {
        let rig = rig(true, true, frame(), selecting(vec![card("Illusion")]));
        rig.gateway.script_post_characters([Ok(()), Ok(())]);
        let mut posted = None;
        look(&rig, &mut posted).await;

        *rig.reader.reading.lock().expect("the reading lock") =
            selecting(vec![card("lllusion"), card("Hammer")]);
        look(&rig, &mut posted).await;

        assert_eq!(
            posts(&rig.gateway),
            vec![
                Call::PostCharacters {
                    cards: vec![card("Illusion")],
                },
                Call::PostCharacters {
                    cards: vec![card("Hammer"), card("Illusion")],
                },
            ],
            "the second set keeps the account's spelling of Illusion"
        );
    }

    #[tokio::test]
    async fn a_misread_alone_is_the_same_card_set_and_is_not_sent_again() {
        let rig = rig(true, true, frame(), selecting(vec![card("Illusion")]));
        rig.gateway.script_post_characters([Ok(())]);
        let mut posted = None;
        look(&rig, &mut posted).await;

        *rig.reader.reading.lock().expect("the reading lock") = selecting(vec![card("lllusion")]);
        look(&rig, &mut posted).await;

        assert_eq!(
            posts(&rig.gateway).len(),
            1,
            "the reconciled set is unchanged"
        );
    }

    /// A blank frame is never read (capture-cascade CAP-02, NFR-02). Before the cascade it was read like any other one
    /// (once per look); a blank capture cannot hold a screen, so the read is pure cost and the screen reads `Unknown`.
    #[tokio::test]
    async fn a_blank_frame_is_captured_but_never_read() {
        let rig = rig(true, true, blank_frame(), selecting(vec![card("Sorc")]));
        rig.device.set_screen(Screen::CharacterSelect);

        for _ in 0..600 {
            look(&rig, &mut None).await;
        }

        assert_eq!(rig.frames.captures.load(Ordering::SeqCst), 600);
        assert_eq!(
            rig.reader.reads.load(Ordering::SeqCst),
            0,
            "no OCR call for a blank frame"
        );
        assert_eq!(*rig.device.screen.borrow(), Screen::Unknown);
        assert!(
            rig.gateway.calls().is_empty(),
            "nothing is sent from a blank frame"
        );
    }

    #[tokio::test]
    async fn the_heartbeat_reports_the_capture_status_of_the_last_look() {
        let rig = rig(true, true, frame(), selecting(Vec::new()));
        assert_eq!(rig.device.capture_report().method_word(), "none");

        look(&rig, &mut None).await;

        // A raw frame source has no cascade: no method, a rate of 0, until a `Capturer` says otherwise.
        assert_eq!(rig.device.capture_report(), CaptureReport::default());
    }

    #[tokio::test]
    async fn six_hundred_usable_looks_make_six_hundred_captures_and_six_hundred_reads() {
        let rig = rig(true, true, frame(), selecting(Vec::new()));

        for _ in 0..600 {
            look(&rig, &mut None).await;
        }

        assert_eq!(rig.frames.captures.load(Ordering::SeqCst), 600);
        assert_eq!(rig.reader.reads.load(Ordering::SeqCst), 600);
    }

    #[tokio::test]
    async fn a_look_without_a_frame_shows_no_method_and_a_reason_only_when_the_game_runs() {
        // The game runs and nothing came: the window says the capture shows nothing.
        let running = rig(true, true, None, selecting(Vec::new()));
        look(&running, &mut None).await;
        let seen = running
            .device
            .hub
            .snapshot()
            .capture
            .expect("a capture view");
        assert_eq!(
            (seen.method, seen.reason),
            ("none", None),
            "a raw source has no status to say it"
        );

        // Consent is not given: nothing is captured, and the view says no method and no reason.
        let silent = rig(false, true, frame(), selecting(Vec::new()));
        look(&silent, &mut None).await;
        let view = silent
            .device
            .hub
            .snapshot()
            .capture
            .expect("a capture view");
        assert_eq!(
            (view.method, view.reason, view.blank),
            ("none", None, false)
        );
    }

    #[tokio::test]
    async fn withdrawing_consent_stops_the_capture_before_the_next_frame() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        look(&rig, &mut None).await;
        assert_eq!(rig.frames.captures.load(Ordering::SeqCst), 1);

        rig.consent
            .save(false)
            .expect("the consent store accepts a write");
        look(&rig, &mut None).await;

        assert_eq!(
            rig.frames.captures.load(Ordering::SeqCst),
            1,
            "no capture after the withdrawal"
        );
        assert_eq!(rig.device.screen.borrow().clone(), Screen::Unknown);
    }

    #[tokio::test]
    async fn no_capture_while_the_game_is_not_running() {
        let rig = rig(true, false, frame(), selecting(vec![card("Sorc")]));

        look(&rig, &mut None).await;

        assert_eq!(rig.frames.captures.load(Ordering::SeqCst), 0);
        assert!(rig.gateway.calls().is_empty());
    }

    /// A text reader that counts its reads and reads nothing.
    struct CountingText(AtomicUsize);

    impl TextReader for CountingText {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(ReadError::EngineUnavailable)
        }
    }

    /// The Party step looks at a frame the screen loop captured, and the loop captures only with the player's consent and
    /// a running game (AGT-06, NFR-04): with a room held, a withdrawn consent or a closed game leaves the step with no
    /// frame to read and nothing to send. The last case shows that the counter works. That the capture source opens the
    /// game window alone is pinned by the window-capture allow-list rules in `scripts/test/agent-source-rules.test.mjs`.
    #[tokio::test]
    async fn the_party_step_reads_nothing_without_consent_or_without_the_game() {
        for (consent, game, expected_reads) in [
            (false, true, false),
            (true, false, false),
            (false, false, false),
            (true, true, true),
        ] {
            let mut rig = rig(
                consent,
                game,
                frame(),
                FrameReading::without_cards(Screen::InGame),
            );
            let text = Arc::new(CountingText(AtomicUsize::new(0)));
            rig.ports.party.read.reader = Arc::clone(&text) as Arc<dyn TextReader + Send + Sync>;
            rig.device.replace_assignment(Some(Assignment {
                room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
                run: std::num::NonZeroU64::new(1).expect("a non-zero run"),
                expected_game_name: GameName::new("mmbaalh-12"),
                members: Vec::new(),
            }));

            look(&rig, &mut None).await;

            let reads = text.0.load(Ordering::SeqCst);
            assert_eq!(
                reads > 0,
                expected_reads,
                "consent {consent}, game {game}: {reads} reads"
            );
            if !expected_reads {
                assert_eq!(
                    rig.frames.captures.load(Ordering::SeqCst),
                    0,
                    "no frame captured"
                );
                assert!(rig.gateway.calls().is_empty(), "nothing is sent");
            }
        }
    }

    #[tokio::test]
    async fn a_minimized_window_reads_as_unknown() {
        let rig = rig(true, true, None, selecting(vec![card("Sorc")]));

        look(&rig, &mut None).await;

        assert_eq!(
            rig.reader.reads.load(Ordering::SeqCst),
            0,
            "no frame, no read"
        );
        assert_eq!(rig.device.screen.borrow().clone(), Screen::Unknown);
    }

    #[tokio::test]
    async fn other_screens_post_nothing() {
        let rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::InGame),
        );

        look(&rig, &mut None).await;

        assert_eq!(*rig.device.screen.borrow(), Screen::InGame);
        assert!(rig.gateway.calls().is_empty());
    }

    #[tokio::test]
    async fn an_empty_card_set_is_never_sent() {
        let rig = rig(true, true, frame(), selecting(Vec::new()));

        look(&rig, &mut None).await;

        assert!(
            rig.gateway.calls().is_empty(),
            "the API takes one to 24 cards"
        );
    }

    #[tokio::test]
    async fn a_failed_post_is_sent_again_on_the_next_frame() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        rig.gateway
            .script_post_characters([Err(ApiError::Network), Ok(())]);
        let mut posted = None;

        look(&rig, &mut posted).await;
        assert!(
            posted.is_none(),
            "a set the API did not take is not recorded"
        );
        look(&rig, &mut posted).await;
        look(&rig, &mut posted).await;

        assert_eq!(
            posts(&rig.gateway).len(),
            2,
            "one failure, one success, then no more"
        );
    }

    #[tokio::test]
    async fn an_unauthorized_post_drops_the_token() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        rig.gateway
            .script_post_characters([Err(ApiError::Unauthorized)]);

        look(&rig, &mut None).await;

        assert!(rig.tokens.load().is_none(), "a 401 forgets the token");
        assert!(!rig.device.is_paired());
    }

    fn diagnostics(rig: &Rig) -> DiagnosticsView {
        rig.device
            .hub
            .snapshot()
            .diagnostics
            .expect("a look was taken")
    }

    #[tokio::test]
    async fn zero_settled_cards_show_the_reasons_and_the_frame_size() {
        let reading = FrameReading {
            screen: Screen::CharacterSelect,
            cards: Vec::new(),
            slots_read: 2,
            popup_options: 3,
            rejected: vec![
                Rejection {
                    slot: 0,
                    reason: RejectReason::NameDisagree,
                },
                Rejection {
                    slot: 1,
                    reason: RejectReason::LevelUnread,
                },
            ],
        };
        let rig = rig(true, true, frame(), reading);

        look(&rig, &mut None).await;

        assert_eq!(
            diagnostics(&rig),
            DiagnosticsView {
                screen: "characterSelect",
                frame_width: 1920,
                frame_height: 1080,
                cards_read: 2,
                cards_settled: 0,
                popup_options_found: 3,
                rejected: vec![
                    RejectedSlot {
                        slot: 0,
                        reason: "name-disagree",
                    },
                    RejectedSlot {
                        slot: 1,
                        reason: "level-unread",
                    },
                ],
                post: "not-sent",
            }
        );
        assert!(rig.gateway.calls().is_empty());
    }

    #[tokio::test]
    async fn a_failed_post_shows_the_error_kind_and_a_taken_one_shows_ok() {
        let rig = rig(true, true, frame(), selecting(vec![card("Sorc")]));
        rig.gateway
            .script_post_characters([Err(ApiError::Server), Ok(())]);
        let mut posted = None;

        look(&rig, &mut posted).await;
        let failed = diagnostics(&rig);
        assert_eq!(failed.post, "server");
        assert_eq!((failed.cards_read, failed.cards_settled), (1, 1));

        look(&rig, &mut posted).await;
        assert_eq!(diagnostics(&rig).post, "ok");

        look(&rig, &mut posted).await;
        assert_eq!(
            diagnostics(&rig).post,
            "ok",
            "no new post keeps the outcome"
        );
    }

    #[tokio::test]
    async fn another_screen_shows_its_name_and_no_cards() {
        let rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::InGame),
        );

        look(&rig, &mut None).await;

        let shown = diagnostics(&rig);
        assert_eq!(shown.screen, "inGame");
        assert_eq!((shown.cards_read, shown.cards_settled), (0, 0));
        assert_eq!(shown.post, "not-sent");
    }
    fn assignment() -> d2rmm_agent_domain::room_assignment::Assignment {
        use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
        Assignment {
            room: RoomId::new("7d9f2c1e-0000-4000-8000-000000000001"),
            run: std::num::NonZeroU64::new(1).expect("a non-zero run"),
            expected_game_name: GameName::new("mmbaalh-16"),
            members: Vec::new(),
        }
    }

    /// Field test 2026-11-21 (ARL-06, CHR-04): the window said "Em jogo" while the site showed an unknown screen, because a
    /// look that gave no usable frame reported `Unknown` and left the last good read in the diagnostics. The window and the
    /// heartbeat now come from one value: a look that sees nothing shows `unknown` in both.
    #[tokio::test]
    async fn a_blank_frame_after_a_game_read_shows_the_reported_screen_in_the_diagnostics() {
        let mut rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::InGame),
        );
        look(&rig, &mut None).await;
        assert_eq!(diagnostics(&rig).screen, "inGame");
        assert_eq!(*rig.device.screen.borrow(), Screen::InGame);

        rig.ports.frames = Arc::new(Frames {
            frame: blank_frame(),
            captures: AtomicUsize::new(0),
        });
        look(&rig, &mut None).await;

        assert_eq!(*rig.device.screen.borrow(), Screen::Unknown);
        let shown = diagnostics(&rig);
        assert_eq!(shown.screen, "unknown", "what the heartbeat reports");
        assert_eq!((shown.cards_read, shown.cards_settled), (0, 0));
        assert!(shown.rejected.is_empty());
        assert_eq!(shown.post, "not-sent", "the last post is not a screen read");
    }

    #[tokio::test]
    async fn a_look_without_a_frame_after_a_game_read_shows_the_reported_screen_in_the_diagnostics()
    {
        let mut rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::InGame),
        );
        look(&rig, &mut None).await;
        assert_eq!(diagnostics(&rig).screen, "inGame");

        rig.ports.frames = Arc::new(Frames {
            frame: None,
            captures: AtomicUsize::new(0),
        });
        look(&rig, &mut None).await;

        assert_eq!(*rig.device.screen.borrow(), Screen::Unknown);
        assert_eq!(diagnostics(&rig).screen, "unknown");
    }

    #[tokio::test]
    async fn the_capture_shows_a_blank_frame_and_no_party_look_without_a_room() {
        let rig = rig(
            true,
            true,
            blank_frame(),
            FrameReading::without_cards(Screen::Unknown),
        );

        look(&rig, &mut None).await;

        let capture = rig
            .device
            .hub
            .snapshot()
            .capture
            .expect("a frame was captured");
        assert!(capture.blank, "a frame with no pixels is blank");
        assert_eq!(
            capture.reason,
            Some("nothing"),
            "the window says the capture shows nothing"
        );
        assert_eq!(capture.brightness, 0);
        assert_eq!((capture.window_width, capture.window_height), (None, None));
        assert_eq!(capture.party, None, "no room, no Party look");
    }

    /// Lesson "A diagnostic line in the agent window must reflect state changes": the Party line kept the look of the game
    /// after the player left it (field test 2026-11-21: "panel open, name matches" on the character selection screen).
    #[tokio::test]
    async fn the_party_look_is_not_shown_once_the_screen_leaves_the_game() {
        let rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::InGame),
        );
        rig.device.replace_assignment(Some(assignment()));
        let party = |rig: &Rig| rig.device.hub.snapshot().capture.and_then(|c| c.party);

        look(&rig, &mut None).await;
        assert!(party(&rig).is_some(), "in the game the look is shown");

        // The held run is done matching, so later looks do not replace the look the game left behind.
        rig.device.set_paired(false);
        *rig.reader.reading.lock().expect("the reading lock") = selecting(Vec::new());
        look(&rig, &mut None).await;
        assert_eq!(party(&rig), None, "left the game: no Party look");

        look(&rig, &mut None).await;
        assert_eq!(party(&rig), None, "and it stays hidden on the next look");

        *rig.reader.reading.lock().expect("the reading lock") =
            FrameReading::without_cards(Screen::InGame);
        look(&rig, &mut None).await;
        assert!(party(&rig).is_some(), "back in the game the look is shown");
    }

    #[tokio::test]
    async fn the_capture_shows_the_party_look_of_the_held_run() {
        let rig = rig(
            true,
            true,
            frame(),
            FrameReading::without_cards(Screen::Unknown),
        );
        rig.device.replace_assignment(Some(assignment()));

        look(&rig, &mut None).await;

        let party = rig.device.hub.snapshot().capture.and_then(|c| c.party);
        assert_eq!(
            party,
            Some(PartyLookView {
                panel_open: false,
                field: "notRead",
                matched: false,
                detail: None,
            }),
            "the panel did not read as open"
        );
    }

    #[test]
    fn the_capture_carries_the_window_size_and_the_look_as_codes() {
        let frame = Rgba {
            width: 1,
            height: 1,
            pixels: vec![200, 200, 200, 255],
        };
        let look = PartyLook {
            panel_open: true,
            field: FieldState::Masked,
            matched: false,
            detail: Some(FieldDetail {
                source: "labelLine",
                variants: 2,
                diff: None,
            }),
        };

        let capture = capture_of(
            summarize(&frame.pixels),
            Some((1936, 1063)),
            Some(look),
            CaptureStatus {
                method: Some(CaptureMethod::GraphicsCapture),
                read_rate_percent: 97,
                unusable: false,
                content: None,
            },
        );

        assert_eq!(
            capture,
            CaptureView {
                brightness: 200,
                blank: true,
                window_width: Some(1936),
                window_height: Some(1063),
                party: Some(PartyLookView {
                    panel_open: true,
                    field: "masked",
                    matched: false,
                    detail: Some(FieldDetailView {
                        source: "labelLine",
                        variants: 2,
                        diff: None,
                    }),
                }),
                method: "graphics-capture",
                read_rate_percent: 97,
                reason: None,
            }
        );
    }

    #[test]
    fn a_look_that_gave_nothing_says_why_and_carries_the_window_size() {
        let status = CaptureStatus {
            method: None,
            read_rate_percent: 0,
            unusable: true,
            content: None,
        };
        let view = unseen_capture(status, Some((1936, 1063)));
        assert_eq!(
            (view.method, view.reason, view.blank, view.window_width),
            ("none", Some("nothing"), true, Some(1936))
        );
        let skipped = unseen_capture(CaptureStatus::default(), None);
        assert_eq!((skipped.reason, skipped.blank), (None, false));
    }
}
