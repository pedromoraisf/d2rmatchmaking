//! The chat post (server-name-match SNM-05, SNM-06; ADR 036). While the agent holds a room, each new "joined" or "left" line
//! of the chat that `chat_step::look_named` read is posted once to the room as a player observation: one name, with the
//! observation's own keys. Nothing else of the chat leaves the agent. The post is not `post_observation::send`: a chat line is
//! gone from the screen after a few seconds, so a failed post is not retried, and it does not confirm the run (only the game
//! name does). At most 20 are posted a minute; the rest are dropped.
//!
//! The name is read-only data here: it is never logged, put in a span, an event, a counter or an error. The span
//! `agent.chat.post` and its event `agent.chat.posts` carry fixed words only: `kind` (`joined`, `left`) and `outcome`
//! (`posted`, `dropped`, `failed`).

use d2rmm_agent_domain::chat::ChatEvent;
use d2rmm_agent_domain::player_observation::{PlayerKind, PlayerObservation};
use d2rmm_agent_domain::room_assignment::Assignment;
use tracing::Instrument;
use uuid::Uuid;

use crate::device_state::DeviceState;
use crate::groups::ReadPorts;
use crate::ports::{ApiError, ApiGateway};

/// How a chat sighting ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostOutcome {
    Posted,
    Dropped,
    Failed,
}

impl PostOutcome {
    /// The fixed word the span and the counter carry.
    pub fn word(self) -> &'static str {
        match self {
            Self::Posted => "posted",
            Self::Dropped => "dropped",
            Self::Failed => "failed",
        }
    }
}

fn kind_of(event: ChatEvent) -> PlayerKind {
    match event {
        ChatEvent::Joined => PlayerKind::Joined,
        ChatEvent::Left => PlayerKind::Left,
    }
}

/// Posts each event of one frame, in order, for the assignment held now. Without an assignment nothing is posted at all.
pub async fn post<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ReadPorts<G>,
    events: Vec<(ChatEvent, String)>,
) -> Vec<PostOutcome> {
    if events.is_empty() {
        return Vec::new();
    }
    let Some(held) = device.assignment.borrow().current().cloned() else {
        return Vec::new();
    };
    let mut outcomes = Vec::with_capacity(events.len());
    for (event, name) in events {
        outcomes.push(post_one(device, ports, &held, event, &name).await);
    }
    outcomes
}

/// One chat sighting for `held`, the assignment the line was read under. It is dropped when that room and run are no longer
/// the held ones, when the name breaks the reading rule, when the minute's 20 are spent, or when no token is held.
pub async fn post_one<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ReadPorts<G>,
    held: &Assignment,
    event: ChatEvent,
    name: &str,
) -> PostOutcome {
    let kind = kind_of(event);
    let span = tracing::info_span!(
        "agent.chat.post",
        kind = kind.word(),
        outcome = tracing::field::Empty
    );
    let outcome = attempt(device, ports, held, kind, name)
        .instrument(span.clone())
        .await;
    span.record("outcome", outcome.word());
    span.in_scope(|| {
        tracing::info!(
            kind = kind.word(),
            outcome = outcome.word(),
            "agent.chat.posts"
        );
    });
    outcome
}

async fn attempt<G: ApiGateway + Send + Sync>(
    device: &DeviceState,
    ports: &ReadPorts<G>,
    held: &Assignment,
    kind: PlayerKind,
    name: &str,
) -> PostOutcome {
    // The run is current only while the assignment held now is still the one the line was read under.
    let still_held = device
        .assignment
        .borrow()
        .current()
        .is_some_and(|now| now.room == held.room && now.run == held.run);
    if !still_held {
        return PostOutcome::Dropped;
    }
    let Ok(room) = Uuid::parse_str(held.room.as_str()) else {
        return PostOutcome::Dropped;
    };
    let captured_at = ports.clock.now_utc();
    let Ok(observation) = PlayerObservation::of(
        kind,
        room,
        held.run,
        ports.ids.idempotency_key(),
        name,
        // The line matched a measured phrase; the OCR gives no confidence for a line, so the observation says it is sure.
        1.0,
        captured_at,
    ) else {
        return PostOutcome::Dropped;
    };
    if !device.take_chat_post(captured_at) {
        return PostOutcome::Dropped;
    }
    let Some(token) = ports.tokens.load() else {
        return PostOutcome::Dropped;
    };
    match ports
        .gateway
        .post_player_observation(&token, &observation)
        .await
    {
        Ok(()) => PostOutcome::Posted,
        Err(error) => {
            if matches!(error, ApiError::Unauthorized | ApiError::UpgradeRequired) {
                device.handle_api_error(&error, ports.tokens.as_ref());
            }
            PostOutcome::Failed
        }
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU64;
    use std::sync::Arc;
    use std::time::Duration;

    use d2rmm_agent_domain::chat::ChatEvent;
    use d2rmm_agent_domain::player_observation::PlayerKind;
    use d2rmm_agent_domain::room_assignment::{Assignment, GameName, RoomId};

    use super::{PostOutcome, post, post_one};
    use crate::device_state::DeviceState;
    use crate::fakes::{Call, FakeApiGateway, MemoryTokens, NullSink};
    use crate::groups::ReadPorts;
    use crate::ports::{ApiError, PausedWallClock, SequentialIds, TextReader, TokenStore};
    use crate::secret::Secret;

    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";
    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    struct NoText;

    impl TextReader for NoText {
        fn read(
            &self,
            _image: &crate::ports::Rgba,
            _region: d2rmm_agent_domain::vision::Region,
        ) -> Result<d2rmm_agent_domain::vision::ReadText, crate::ports::ReadError> {
            Err(crate::ports::ReadError::Failed)
        }
    }

    struct Rig {
        device: DeviceState,
        ports: ReadPorts<FakeApiGateway>,
        gateway: Arc<FakeApiGateway>,
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
        let ports = ReadPorts {
            reader: Arc::new(NoText),
            ids: Arc::new(SequentialIds::new()),
            clock: Arc::new(PausedWallClock::starting_at(
                "2026-11-21T10:00:00Z".parse().expect("a valid instant"),
            )),
            gateway: Arc::clone(&gateway),
            tokens: Arc::clone(&tokens) as Arc<dyn TokenStore + Send + Sync>,
        };
        Rig {
            device,
            ports,
            gateway,
            tokens,
        }
    }

    fn assignment(run: u64) -> Assignment {
        Assignment {
            room: RoomId::new(ROOM),
            run: NonZeroU64::new(run).expect("a non-zero run"),
            expected_game_name: GameName::new("mmcowsh-1"),
            members: Vec::new(),
        }
    }

    fn hold(rig: &Rig, run: u64) -> Assignment {
        rig.device.replace_assignment(Some(assignment(run)));
        assignment(run)
    }

    fn joined(name: &str) -> Vec<(ChatEvent, String)> {
        vec![(ChatEvent::Joined, name.to_string())]
    }

    fn posted_calls(rig: &Rig) -> Vec<Call> {
        rig.gateway
            .calls()
            .into_iter()
            .filter(|call| matches!(call, Call::PostPlayerObservation(_)))
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn a_joined_line_is_posted_once_with_the_run_the_room_and_the_name() {
        let rig = rig();
        hold(&rig, 3);
        rig.gateway.script_post_player_observation([Ok(())]);

        let outcomes = post(&rig.device, &rig.ports, joined("Zzyzx")).await;

        assert_eq!(outcomes, [PostOutcome::Posted]);
        let calls = posted_calls(&rig);
        assert_eq!(calls.len(), 1);
        let Call::PostPlayerObservation(observation) = &calls[0] else {
            panic!("a player observation");
        };
        assert_eq!(observation.kind, PlayerKind::Joined);
        assert_eq!(observation.room.to_string(), ROOM);
        assert_eq!(observation.run.get(), 3);
        assert_eq!(observation.name(), "Zzyzx");
        assert_eq!(observation.confidence, 1.0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_left_line_is_posted_as_left_and_each_event_has_its_own_key() {
        let rig = rig();
        hold(&rig, 1);
        rig.gateway.script_post_player_observation([Ok(()), Ok(())]);

        let outcomes = post(
            &rig.device,
            &rig.ports,
            vec![
                (ChatEvent::Left, "Eve".to_string()),
                (ChatEvent::Joined, "Bob".to_string()),
            ],
        )
        .await;

        assert_eq!(outcomes, [PostOutcome::Posted, PostOutcome::Posted]);
        let kinds_and_keys: Vec<_> = posted_calls(&rig)
            .into_iter()
            .map(|call| match call {
                Call::PostPlayerObservation(o) => (o.kind, o.key),
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(kinds_and_keys[0].0, PlayerKind::Left);
        assert_eq!(kinds_and_keys[1].0, PlayerKind::Joined);
        assert_ne!(kinds_and_keys[0].1, kinds_and_keys[1].1);
    }

    #[tokio::test(start_paused = true)]
    async fn nothing_is_posted_without_an_assignment() {
        let rig = rig();

        let outcomes = post(&rig.device, &rig.ports, joined("Bob")).await;

        assert!(outcomes.is_empty());
        assert!(rig.gateway.calls().is_empty(), "the agent sent nothing");
    }

    #[tokio::test(start_paused = true)]
    async fn a_line_read_for_another_run_or_room_is_dropped() {
        let rig = rig();
        let read_under = hold(&rig, 1);
        hold(&rig, 2);
        let outcome = post_one(
            &rig.device,
            &rig.ports,
            &read_under,
            ChatEvent::Joined,
            "Bob",
        )
        .await;
        assert_eq!(outcome, PostOutcome::Dropped);

        let mut other_room = assignment(2);
        other_room.room = RoomId::new("7d9f2c1e-0000-4000-8000-000000000002");
        let outcome = post_one(
            &rig.device,
            &rig.ports,
            &other_room,
            ChatEvent::Joined,
            "Bob",
        )
        .await;
        assert_eq!(outcome, PostOutcome::Dropped);

        rig.device.replace_assignment(None);
        let outcome = post_one(
            &rig.device,
            &rig.ports,
            &assignment(2),
            ChatEvent::Joined,
            "Bob",
        )
        .await;
        assert_eq!(outcome, PostOutcome::Dropped);
        assert!(rig.gateway.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_room_id_that_is_not_a_uuid_is_dropped() {
        let rig = rig();
        let mut odd = assignment(1);
        odd.room = RoomId::new("not-a-uuid");
        rig.device.replace_assignment(Some(odd.clone()));
        let outcome = post_one(&rig.device, &rig.ports, &odd, ChatEvent::Joined, "Bob").await;
        assert_eq!(outcome, PostOutcome::Dropped);
        assert!(rig.gateway.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn a_name_that_breaks_the_reading_rule_is_dropped_and_sent_to_nobody() {
        let rig = rig();
        hold(&rig, 1);
        for name in ["A", "Bob!", "1Bob", "Bo b", "Abcdefghijklmnop", "B-o-b"] {
            let outcomes = post(&rig.device, &rig.ports, joined(name)).await;
            assert_eq!(outcomes, [PostOutcome::Dropped], "{name}");
        }
        assert!(rig.gateway.calls().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn the_twenty_first_post_in_a_minute_is_dropped_and_the_next_minute_posts_again() {
        let rig = rig();
        hold(&rig, 1);
        rig.gateway
            .script_post_player_observation(std::iter::repeat_n(Ok(()), 21));
        for n in 0..20 {
            let outcomes = post(&rig.device, &rig.ports, joined("Bob")).await;
            assert_eq!(outcomes, [PostOutcome::Posted], "post {n}");
        }
        assert_eq!(
            post(&rig.device, &rig.ports, joined("Bob")).await,
            [PostOutcome::Dropped]
        );
        assert_eq!(posted_calls(&rig).len(), 20);

        tokio::time::advance(Duration::from_secs(60)).await;
        assert_eq!(
            post(&rig.device, &rig.ports, joined("Bob")).await,
            [PostOutcome::Posted]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_post_is_failed_once_and_never_retried_or_confirmed() {
        let rig = rig();
        hold(&rig, 1);
        rig.gateway
            .script_post_player_observation([Err(ApiError::Network), Ok(())]);

        let outcomes = post(&rig.device, &rig.ports, joined("Bob")).await;

        assert_eq!(outcomes, [PostOutcome::Failed]);
        assert_eq!(posted_calls(&rig).len(), 1, "no retry");
        assert_eq!(rig.device.dropped_observations(), 0);
        assert!(rig.device.assignment.borrow().current().is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn a_success_does_not_confirm_the_run() {
        let rig = rig();
        hold(&rig, 1);
        rig.device.publish_room();
        rig.gateway.script_post_player_observation([Ok(())]);
        post(&rig.device, &rig.ports, joined("Bob")).await;
        rig.device.publish_room();
        // `confirm_run` is the game name's: the room view shows the run unconfirmed (ARL-03).
        let confirmed = rig.device.hub.snapshot().room.map(|room| room.confirmed);
        assert_eq!(confirmed, Some(false));
    }

    #[tokio::test(start_paused = true)]
    async fn an_unauthorized_answer_unpairs_like_every_other_post() {
        let rig = rig();
        hold(&rig, 1);
        rig.gateway
            .script_post_player_observation([Err(ApiError::Unauthorized)]);

        let outcomes = post(&rig.device, &rig.ports, joined("Bob")).await;

        assert_eq!(outcomes, [PostOutcome::Failed]);
        assert!(rig.tokens.load().is_none(), "the token was dropped");
        assert!(!rig.device.is_paired());
    }

    #[tokio::test(start_paused = true)]
    async fn no_token_means_nothing_is_sent() {
        let rig = rig();
        hold(&rig, 1);
        rig.tokens.delete();
        let outcomes = post(&rig.device, &rig.ports, joined("Bob")).await;
        assert_eq!(outcomes, [PostOutcome::Dropped]);
        assert!(rig.gateway.calls().is_empty());
    }

    #[test]
    fn the_outcome_words_are_fixed() {
        assert_eq!(PostOutcome::Posted.word(), "posted");
        assert_eq!(PostOutcome::Dropped.word(), "dropped");
        assert_eq!(PostOutcome::Failed.word(), "failed");
    }

    #[tokio::test(start_paused = true)]
    async fn a_line_that_stays_on_screen_is_posted_once() {
        use d2rmm_agent_domain::chat::ChatTracker;
        use d2rmm_agent_domain::language::LanguagePack;

        let rig = rig();
        hold(&rig, 1);
        rig.gateway.script_post_player_observation([Ok(()), Ok(())]);
        let pack = LanguagePack::english();
        let mut tracker = ChatTracker::default();
        let mut posted = 0;
        for lines in [
            vec!["Zzyzx joined our world"],
            vec!["Zzyzx joined our world"],
            vec!["Zzyzx joined our world", "Zzyzx left our world"],
        ] {
            let events = tracker.next_named(&[&pack], &lines);
            posted += post(&rig.device, &rig.ports, events).await.len();
        }
        assert_eq!(posted, 2, "the joined line once, the left line once");
        assert_eq!(posted_calls(&rig).len(), 2);
    }

    /// One post of "Zzyzx", read with a recording subscriber. A subscriber installed for a thread shares tracing's callsite
    /// cache with the tests beside it, which can hide an event; the post is repeated on a fresh rig, up to a bound, until
    /// the cache lets it through (the same bound as the chat step's test).
    async fn recorded_post() -> (
        Vec<crate::event_probe::Recorded>,
        Vec<crate::event_probe::Recorded>,
    ) {
        let probe = crate::event_probe::EventProbe::default();
        let _guard = probe.install();
        tracing::callsite::rebuild_interest_cache();
        let rig = rig();
        hold(&rig, 1);
        rig.gateway
            .script_post_player_observation([Ok(()), Err(ApiError::Network)]);
        post(&rig.device, &rig.ports, joined("Zzyzx")).await;
        post(
            &rig.device,
            &rig.ports,
            vec![(ChatEvent::Left, "Zzyzx".to_string())],
        )
        .await;
        (probe.spans(), probe.events())
    }

    #[tokio::test(start_paused = true)]
    async fn no_span_event_or_counter_of_the_post_holds_the_name() {
        let mut seen = (Vec::new(), Vec::new());
        for _attempt in 0..40 {
            seen = recorded_post().await;
            if !seen.1.is_empty() && !seen.0.is_empty() {
                break;
            }
        }
        let (spans, events) = seen;
        let spans: Vec<_> = spans
            .into_iter()
            .filter(|span| span.message == "agent.chat.post")
            .collect();
        let counters: Vec<_> = events
            .into_iter()
            .filter(|event| event.message == "agent.chat.posts")
            .collect();
        assert_eq!(spans.len(), 2, "one span per sighting");
        assert_eq!(counters.len(), 2, "one counter per sighting");
        for recorded in spans.iter().chain(counters.iter()) {
            let keys: Vec<&str> = recorded.fields.keys().map(String::as_str).collect();
            assert_eq!(keys, ["kind", "outcome"], "{recorded:?}");
            for (key, value) in &recorded.fields {
                for secret in ["Zzyzx", "zzyzx", "ZZYZX"] {
                    assert!(!value.contains(secret), "{key} holds the name");
                    assert!(!key.contains(secret), "a key holds the name");
                }
            }
            assert!(!recorded.message.to_lowercase().contains("zzyzx"));
        }
        let words = |list: &[crate::event_probe::Recorded], key: &str| -> Vec<String> {
            list.iter()
                .map(|recorded| recorded.fields[key].trim_matches('"').to_string())
                .collect()
        };
        assert_eq!(words(&spans, "kind"), ["joined", "left"]);
        assert_eq!(words(&spans, "outcome"), ["posted", "failed"]);
        assert_eq!(words(&counters, "kind"), ["joined", "left"]);
        assert_eq!(words(&counters, "outcome"), ["posted", "failed"]);
    }
}
