//! The chat step (design.md § The chat; GNR-07, GNR-10). While the agent holds a room, each captured frame's chat band is
//! read, and the lines that say a player joined or left are told from the lines of the frame before: a line that stays on
//! screen counts once. The events are counted with a fixed word (`joined` or `left`) and posted by nobody: no observation,
//! no name, no text leaves the process, and no name is logged or put in a span or a label. A later feature
//! (`server-name-match`) reads these events when it owns the contract. The OCR runs on a blocking thread.

use std::sync::Arc;

use d2rmm_agent_domain::chat::ChatEvent;
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{ScreenRegion, screen_region};

use crate::device_state::DeviceState;
use crate::party::PartyPorts;
use crate::ports::Rgba;

/// One look at the chat band of `frame`. Nothing is read without a held assignment (the chat only matters inside a room), and
/// the tracker forgets the last frame when none is held. Returns the events of the lines that are new in this frame.
pub async fn look<G>(
    device: &DeviceState,
    ports: &PartyPorts<G>,
    frame: Arc<Rgba>,
) -> Vec<ChatEvent> {
    if device.assignment.borrow().current().is_none() {
        device.with_chat(|tracker| tracker.reset());
        return Vec::new();
    }
    let Some(area) = screen_region(ScreenRegion::ChatArea, frame.width, frame.height) else {
        device.with_chat(|tracker| tracker.reset());
        return Vec::new();
    };
    let reader = Arc::clone(&ports.read.reader);
    let lines = tokio::task::spawn_blocking(move || reader.read_lines(&frame, area)).await;
    let Ok(lines) = lines else {
        return Vec::new();
    };
    // The shipped pack first, then its fallback (the Brazilian one): the chat of a pt-BR client says the same things in
    // other words.
    let mut packs: Vec<&LanguagePack> = vec![&ports.language];
    packs.extend(ports.language.fallback());
    let span = tracing::info_span!("agent.vision.read-chat", events = tracing::field::Empty);
    let _entered = span.enter();
    let texts: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();
    let events = device.with_chat(|tracker| tracker.next(&packs, &texts));
    span.record("events", events.len());
    for event in &events {
        tracing::info!(kind = event.kind(), "agent.vision.chat_events");
    }
    events
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use d2rmm_agent_domain::chat::ChatEvent;
    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::look;
    use crate::device_state::DeviceState;
    use crate::event_probe::EventProbe;
    use crate::fakes::{FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::ReadPorts;
    use crate::party::PartyPorts;
    use crate::ports::{PausedWallClock, ReadError, Rgba, SequentialIds, TextReader, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    /// A chat whose lines are set by the test: a region answers the lines whose middle it holds. Reads are counted.
    #[derive(Default)]
    struct Chat {
        lines: Mutex<Vec<TextLine>>,
        reads: AtomicUsize,
    }

    impl Chat {
        fn say(&self, texts: &[&str]) {
            *self.lines.lock().expect("the chat lock") = texts
                .iter()
                .zip(0u32..)
                .map(|(text, index)| TextLine {
                    text: (*text).to_string(),
                    region: Region {
                        x: 24,
                        y: 656 + index * 40,
                        width: 530,
                        height: 18,
                    },
                })
                .collect();
        }
    }

    impl TextReader for Chat {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Err(ReadError::Failed)
        }

        fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.lines
                .lock()
                .expect("the chat lock")
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
        chat: Arc<Chat>,
    }

    fn rig() -> Rig {
        let gateway = Arc::new(FakeApiGateway::new());
        let tokens = Arc::new(MemoryTokens::default());
        tokens
            .save(&Secret::new(TOKEN))
            .expect("the memory store accepts a write");
        let device = DeviceState::new(Arc::new(NullSink));
        device.set_paired(true);
        let chat = Arc::new(Chat::default());
        let ports = PartyPorts {
            read: ReadPorts {
                reader: Arc::clone(&chat) as Arc<dyn TextReader + Send + Sync>,
                ids: Arc::new(SequentialIds::new()),
                clock: Arc::new(PausedWallClock::starting_at(
                    "2026-11-10T10:00:00Z".parse().expect("a valid instant"),
                )),
                gateway: Arc::clone(&gateway),
                tokens: tokens as Arc<dyn TokenStore + Send + Sync>,
            },
            language: Arc::new(LanguagePack::english().with_fallback(brazilian())),
        };
        Rig {
            device,
            ports,
            gateway,
            chat,
        }
    }

    /// The pack of `resources/lang/pt-BR.json` (the app crate's test pins the file to these words).
    fn brazilian() -> LanguagePack {
        let words = [
            ("party", "Grupo"),
            ("gameName", "Nome"),
            ("password", "Senha"),
            ("joinedGame", "entrou em nosso mundo"),
            ("leftGame", "saiu de nosso mundo"),
        ]
        .map(|(key, word)| (key.to_string(), word.to_string()));
        LanguagePack::from_words("pt-BR", words).expect("the pack builds")
    }

    fn hold_a_room(rig: &Rig) {
        rig.device.replace_assignment(Some(Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(1).expect("a non-zero run"),
            expected_game_name: GameName::new("mmcowsh-1"),
            members: Vec::new(),
        }));
    }

    fn frame(width: u32, height: u32) -> Rgba {
        Rgba {
            width,
            height,
            pixels: Vec::new(),
        }
    }

    async fn look_at(rig: &Rig) -> Vec<ChatEvent> {
        look(&rig.device, &rig.ports, Arc::new(frame(1920, 1033))).await
    }

    #[tokio::test(start_paused = true)]
    async fn a_chat_line_posts_no_observation_and_sends_no_name() {
        let rig = rig();
        hold_a_room(&rig);
        rig.chat.say(&["Bob joined our world"]);

        let events = look_at(&rig).await;

        assert_eq!(events, [ChatEvent::Joined]);
        assert!(rig.gateway.calls().is_empty(), "nothing is sent at all");
    }

    #[tokio::test(start_paused = true)]
    async fn a_repeated_line_counts_once_and_a_return_counts_again() {
        let rig = rig();
        hold_a_room(&rig);
        rig.chat.say(&["Bob joined our world"]);
        assert_eq!(look_at(&rig).await.len(), 1);
        assert_eq!(look_at(&rig).await.len(), 0, "the same line, next frame");

        rig.chat
            .say(&["Bob joined our world", "Bob left our world"]);
        assert_eq!(look_at(&rig).await, [ChatEvent::Left]);

        rig.chat.say(&["Bob left our world"]);
        assert_eq!(look_at(&rig).await.len(), 0, "the joined line faded");
        rig.chat
            .say(&["Bob left our world", "Bob joined our world"]);
        assert_eq!(look_at(&rig).await, [ChatEvent::Joined]);
    }

    #[tokio::test(start_paused = true)]
    async fn the_portuguese_words_count_too_and_other_lines_do_not() {
        let rig = rig();
        hold_a_room(&rig);
        rig.chat.say(&[
            "Bob entrou em nosso mundo",
            "Eve saiu de nosso mundo",
            "Bob: hello there",
        ]);

        assert_eq!(look_at(&rig).await, [ChatEvent::Joined, ChatEvent::Left]);
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_read_without_a_room_and_the_last_frame_is_forgotten() {
        let rig = rig();
        rig.chat.say(&["Bob joined our world"]);
        assert!(look_at(&rig).await.is_empty());
        assert_eq!(rig.chat.reads.load(Ordering::SeqCst), 0, "no room, no read");

        hold_a_room(&rig);
        assert_eq!(look_at(&rig).await.len(), 1);
        rig.device.replace_assignment(None);
        assert!(look_at(&rig).await.is_empty());
        hold_a_room(&rig);
        assert_eq!(look_at(&rig).await.len(), 1, "a new room starts afresh");
    }

    #[tokio::test(start_paused = true)]
    async fn a_line_outside_the_chat_band_or_an_unsupported_size_is_not_read() {
        let rig = rig();
        hold_a_room(&rig);
        // The band ends at 80% of 1033 = 826: a line at y 900 is the HUD's, not the chat's.
        *rig.chat.lines.lock().expect("the chat lock") = vec![TextLine {
            text: "Bob joined our world".to_string(),
            region: Region {
                x: 24,
                y: 900,
                width: 530,
                height: 18,
            },
        }];
        assert!(look_at(&rig).await.is_empty());

        rig.chat.say(&["Bob joined our world"]);
        let events = look(&rig.device, &rig.ports, Arc::new(frame(1280, 1024))).await;
        assert!(events.is_empty());
    }

    /// The counter's kinds for one frame with a joined and a left line, read with a recording subscriber. A subscriber installed
    /// for a thread shares tracing's process-wide callsite cache with the tests beside it (`cargo test` runs them in one
    /// process), which can hide an event; the frame is looked at again on a fresh rig, up to a bound, until the cache lets
    /// the events through. The absence of a name holds on every attempt.
    async fn counted_kinds() -> Vec<String> {
        let probe = EventProbe::default();
        let _guard = probe.install();
        let rig = rig();
        hold_a_room(&rig);
        rig.chat
            .say(&["Bob joined our world", "Evelyn left our world"]);
        tracing::callsite::rebuild_interest_cache();
        look_at(&rig).await;

        for event in probe.events() {
            for (key, value) in &event.fields {
                assert!(
                    !value.contains("Bob") && !value.contains("Evelyn"),
                    "{key} holds a name"
                );
            }
            assert!(!event.message.contains("Bob"));
        }
        probe
            .named("agent.vision.chat_events")
            .iter()
            .map(|event| {
                event
                    .fields
                    .get("kind")
                    .map_or(String::new(), |v| v.trim_matches('"').to_string())
            })
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn the_counter_carries_a_fixed_word_and_no_name() {
        let mut seen = Vec::new();
        for _attempt in 0..40 {
            seen = counted_kinds().await;
            if !seen.is_empty() {
                break;
            }
        }
        assert_eq!(seen, ["joined", "left"]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_pin_of_the_fixture_frames_through_look() {
        // Rule 14 pin: the drawn fixtures' lines (chat-both, then chat-joined-later's height) give these events.
        let rig = rig();
        hold_a_room(&rig);
        rig.chat
            .say(&["Bob joined our world", "Eve left our world"]);
        assert_eq!(look_at(&rig).await, [ChatEvent::Joined, ChatEvent::Left]);
        assert!(look_at(&rig).await.is_empty(), "the same frame again");
        rig.chat.say(&[
            "Eve left our world",
            "Bob joined our world",
            "Bob joined our world",
        ]);
        assert_eq!(look_at(&rig).await, [ChatEvent::Joined]);
    }
}
