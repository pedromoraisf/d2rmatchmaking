//! The screen loop (design.md § Agent; CHR-01 to CHR-06). Once a second the agent asks whether the player has consented and
//! whether the game runs; only then does it capture the game window in memory, read the screen the frame shows and, on the
//! character selection screen, send the complete cards it read. Nothing captured leaves the process (ADR 010, NFR-04). The
//! screen is shared with the heartbeat, which beats at once when it changes (CHR-04, CHR-05).

use std::sync::Arc;
use std::time::Duration;

use d2rmm_agent_domain::characters::{Card, reconcile_names};
use d2rmm_agent_domain::presence::game_running;

use crate::device_state::DeviceState;
use crate::messages::{FrameReading, Screen};
use crate::party::{self, PartyPorts};
use crate::ports::{
    ApiError, ApiGateway, ConsentStore, FrameReader, FrameSource, ProcessSource, Rgba, TokenStore,
};

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
        device.set_screen(Screen::Unknown);
        return;
    };
    let frame = Arc::new(frame);
    let reading = read_screen(ports, &frame);
    device.set_screen(reading.screen);
    party::look(device, &ports.party, Arc::clone(&frame)).await;
    let FrameReading {
        screen: Screen::CharacterSelect,
        cards,
    } = reading
    else {
        return;
    };
    // A name the screen misread (I, l and 1 are one glyph to it) keeps the spelling the account already has (CHR-10).
    let cards = in_name_order(reconcile_names(cards, posted.as_deref().unwrap_or(&[])));
    // The API takes 1 to 24 cards; an empty reading sends nothing, and a set the API already has is not sent again.
    if cards.is_empty() || posted.as_ref() == Some(&cards) || !device.api_allowed() {
        return;
    }
    let Some(token) = ports.tokens.load() else {
        return;
    };
    match ports.gateway.post_characters(&token, &cards).await {
        Ok(()) => *posted = Some(cards),
        Err(error @ (ApiError::Unauthorized | ApiError::UpgradeRequired)) => {
            device.handle_api_error(&error, ports.tokens.as_ref());
        }
        // Any other failure keeps the set unsent, so the next tick sends it again.
        Err(_) => {}
    }
}

/// The game window's frame, when the player has consented, the game runs and a frame came. `None` otherwise: in each case
/// nothing is captured past the check that failed (CHR-01, CHR-02, CHR-03).
fn capture<G>(ports: &ScreenPorts<G>) -> Option<Rgba> {
    if !ports.consent.load() {
        return None;
    }
    if !game_running(&ports.processes.names()) {
        return None;
    }
    ports.frames.capture()
}

/// What the frame shows: its screen, and its cards on the character selection screen.
fn read_screen<G>(ports: &ScreenPorts<G>, frame: &Rgba) -> FrameReading {
    let span = tracing::info_span!(
        "agent.vision.read-characters",
        screen = tracing::field::Empty,
        cards = tracing::field::Empty,
    );
    let _entered = span.enter();
    let reading = ports.reader.read(frame);
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

    use d2rmm_agent_domain::characters::{Card, Class, Mode, Title};

    use super::{ScreenPorts, tick};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NoText, NullSink};
    use crate::groups::ReadPorts;
    use crate::messages::{FrameReading, Screen};
    use crate::party::PartyPorts;
    use crate::ports::{
        ApiError, ConsentStore, FrameReader, FrameSource, PausedWallClock, ProcessSource, Rgba,
        SequentialIds, StoreError, TokenStore,
    };
    use crate::secret::Secret;
    use d2rmm_agent_domain::language::LanguagePack;

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

    fn frame() -> Option<Rgba> {
        Some(Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        })
    }

    fn selecting(cards: Vec<Card>) -> FrameReading {
        FrameReading {
            screen: Screen::CharacterSelect,
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
            FrameReading {
                screen: Screen::InGame,
                cards: Vec::new(),
            },
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
}
