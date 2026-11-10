//! The anti-corruption layer between the contract types and the message types (ADR 027, rule 3; design.md § Adapters, ACL).
//! Each function maps one shape in either direction and adds no check the code lacks today: a value the contract allows
//! reaches the message type unchanged. The pure mapping lives here; the HTTP calls live in `gateway.rs`.

use d2rmm_agent_core::messages::{
    GameNameObservation, InvalidPairingCode, IssuedCode, PairingCode, Presence, Screen,
};
use d2rmm_agent_domain::characters::{Card, Class, Difficulty, Era, LadderFlag, Mode};
use d2rmm_agent_domain::room_assignment::{Assignment, GameName, Member, MemberRole, RoomId};
use serde_json::json;

use crate::contracts::generated as contract;

/// A contract assignment as the message type carries it. The room id stays opaque (AGS-14).
pub fn assignment_from_contract(value: contract::Assignment) -> Assignment {
    Assignment {
        room: RoomId::new(value.room_id.as_str()),
        run: value.run,
        expected_game_name: GameName::new(value.expected_game_name.as_str()),
        members: value
            .members
            .into_iter()
            .map(member_from_contract)
            .collect(),
    }
}

/// A message assignment in its contract shape. Fails only when a value does not satisfy the contract's own rules.
pub fn assignment_to_contract(
    value: &Assignment,
) -> Result<contract::Assignment, serde_json::Error> {
    serde_json::from_value(json!({
        "roomId": value.room.as_str(),
        "run": value.run.get(),
        "expectedGameName": value.expected_game_name.as_str(),
        "members": value.members.iter().map(member_to_json).collect::<Vec<_>>(),
    }))
}

fn member_from_contract(item: contract::AssignmentMembersItem) -> Member {
    Member {
        account_id: item.account_id.as_str().to_string(),
        character_id: item.character_id.map(|id| id.as_str().to_string()),
        join_order: item.join_order,
        role: match item.role {
            contract::AssignmentMembersItemRole::Host => MemberRole::Host,
            contract::AssignmentMembersItemRole::Member => MemberRole::Member,
        },
    }
}

fn member_to_json(member: &Member) -> serde_json::Value {
    json!({
        "accountId": member.account_id,
        "characterId": member.character_id,
        "joinOrder": member.join_order.get(),
        "role": match member.role {
            MemberRole::Host => "host",
            MemberRole::Member => "member",
        },
    })
}

/// The code and claim secret the API issued. The code is six digits by the contract's own pattern.
pub fn issued_code_from_contract(
    value: contract::PairingCodeResponse,
) -> Result<IssuedCode, InvalidPairingCode> {
    Ok(IssuedCode {
        code: PairingCode::new(value.code.as_str())?,
        expires_at: value.expires_at,
        claim_secret: value.claim_secret,
    })
}

/// The heartbeat body of the contract: the agent version, the game state and the screen. The capture block says the agent
/// captures nothing yet (F0), as the heartbeat has always sent it.
pub fn heartbeat_from_presence(
    presence: &Presence,
    version: &str,
) -> Result<contract::Heartbeat, serde_json::Error> {
    serde_json::from_value(json!({
        "agentVersion": version,
        "pcState": "IDLE",
        "game": { "running": presence.game_running, "window": "", "screen": screen_word(presence.screen) },
        "capture": { "method": "none", "readRate": 0 },
    }))
}

/// The screen as the contract spells it (`Screen` of the contract, CHR-04).
fn screen_word(screen: Screen) -> &'static str {
    match screen {
        Screen::Unknown => "UNKNOWN",
        Screen::CharacterSelect => "CHARACTER_SELECT",
        Screen::InGame => "IN_GAME",
        Screen::AutomapOpen => "AUTOMAP_OPEN",
    }
}

/// The complete cards of one character selection screen in the contract's batch shape (CHR-06, CHR-09). The domain already
/// holds every value the contract's rules check, so a failure here is a bug and never a partial batch.
pub fn characters_to_contract(
    cards: &[Card],
) -> Result<contract::RecordCharactersRequest, serde_json::Error> {
    serde_json::from_value(json!({
        "characters": cards.iter().map(card_to_json).collect::<Vec<_>>(),
    }))
}

fn card_to_json(card: &Card) -> serde_json::Value {
    json!({
        "name": card.name(),
        "class": class_word(card.class()),
        "level": card.level(),
        "ladder": ladder_word(card.mode(), card.ladder()),
        "era": era_word(card.era()),
        "unlockedDifficulties": card
            .unlocked_difficulties()
            .into_iter()
            .map(difficulty_word)
            .collect::<Vec<_>>(),
    })
}

fn class_word(class: Class) -> &'static str {
    match class {
        Class::Amazon => "amazon",
        Class::Assassin => "assassin",
        Class::Barbarian => "barbarian",
        Class::Druid => "druid",
        Class::Necromancer => "necromancer",
        Class::Paladin => "paladin",
        Class::Sorceress => "sorceress",
        Class::Warlock => "warlock",
    }
}

fn era_word(era: Era) -> &'static str {
    match era {
        Era::Classic => "classic",
        Era::Lod => "lod",
        Era::Rotw => "rotw",
    }
}

fn ladder_word(mode: Mode, ladder: LadderFlag) -> &'static str {
    match (mode, ladder) {
        (Mode::Softcore, LadderFlag::Ladder) => "sc-ladder",
        (Mode::Softcore, LadderFlag::NonLadder) => "sc-nonladder",
        (Mode::Hardcore, LadderFlag::Ladder) => "hc-ladder",
        (Mode::Hardcore, LadderFlag::NonLadder) => "hc-nonladder",
    }
}

fn difficulty_word(difficulty: Difficulty) -> &'static str {
    match difficulty {
        Difficulty::Normal => "normal",
        Difficulty::Nightmare => "nightmare",
        Difficulty::Hell => "hell",
    }
}

/// A `GAME_NAME_SEEN` observation in its contract shape.
pub fn observation_to_contract(
    value: &GameNameObservation,
) -> Result<contract::Observation, serde_json::Error> {
    serde_json::from_value(json!({
        "idempotencyKey": value.key.to_string(),
        "type": "GAME_NAME_SEEN",
        "run": value.run.get(),
        "value": value.game_name,
        "confidence": value.confidence,
        "capturedAt": value.captured_at,
    }))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::num::NonZeroU64;

    use chrono::{DateTime, Utc};
    use serde_json::{Value, json};
    use uuid::Uuid;

    use super::{
        assignment_from_contract, assignment_to_contract, characters_to_contract,
        heartbeat_from_presence, issued_code_from_contract, observation_to_contract,
    };
    use crate::contracts::generated as contract;
    use crate::contracts::schemas::SCHEMAS;
    use d2rmm_agent_core::messages::{GameNameObservation, Presence, Screen};
    use d2rmm_agent_domain::characters::{Card, Class, Era, LadderFlag, Mode, Title};
    use d2rmm_agent_domain::room_assignment::{Member, MemberRole};

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";

    /// The agent schema `name`, as the crate's own copy holds it (`contracts/schemas.rs`), so the tests run from a copy of the
    /// crate as well.
    fn schema(name: &str) -> jsonschema::Validator {
        let (_, text) = SCHEMAS
            .iter()
            .find(|(file, _)| *file == name)
            .expect("the crate holds every agent schema");
        let value: Value = serde_json::from_str(text).expect("the schema is JSON");
        jsonschema::validator_for(&value).expect("the schema compiles")
    }

    fn nonzero(value: u64) -> NonZeroU64 {
        NonZeroU64::new(value).expect("a non-zero number")
    }

    fn contract_assignment(room: &str) -> contract::Assignment {
        serde_json::from_value(json!({
            "roomId": room,
            "run": 3,
            "expectedGameName": "mmbaalh-12",
            "members": [
                { "accountId": "account-1", "characterId": "character-1", "joinOrder": 1, "role": "host" },
                { "accountId": "account-2", "characterId": null, "joinOrder": 2, "role": "member" },
            ],
        }))
        .expect("a contract assignment")
    }

    fn now() -> DateTime<Utc> {
        "2026-10-31T10:00:00Z".parse().expect("a valid instant")
    }

    #[test]
    fn assignment_translation_keeps_every_field() {
        let source = contract_assignment(ROOM);
        let expected = serde_json::to_value(&source).expect("the source serializes");

        let message = assignment_from_contract(source);

        assert_eq!(message.room.as_str(), ROOM);
        assert_eq!(message.run, nonzero(3));
        assert_eq!(message.expected_game_name.as_str(), "mmbaalh-12");
        assert_eq!(
            message.members,
            vec![
                Member {
                    account_id: "account-1".into(),
                    character_id: Some("character-1".into()),
                    join_order: nonzero(1),
                    role: MemberRole::Host,
                },
                Member {
                    account_id: "account-2".into(),
                    character_id: None,
                    join_order: nonzero(2),
                    role: MemberRole::Member,
                },
            ]
        );
        let back = assignment_to_contract(&message).expect("the message translates back");
        assert_eq!(
            serde_json::to_value(&back).expect("the contract serializes"),
            expected,
            "the round trip keeps every field"
        );
    }

    #[test]
    fn heartbeat_translation_matches_the_contract() {
        let presence = Presence {
            game_running: true,
            screen: Screen::AutomapOpen,
        };

        let heartbeat = heartbeat_from_presence(&presence, "0.0.1").expect("a contract heartbeat");
        let sent = serde_json::to_value(&heartbeat).expect("the heartbeat serializes");

        assert_eq!(sent["agentVersion"], "0.0.1");
        assert_eq!(sent["pcState"], "IDLE");
        assert_eq!(sent["game"]["running"], true);
        assert_eq!(sent["game"]["window"], "");
        assert_eq!(sent["game"]["screen"], "AUTOMAP_OPEN");
        assert_eq!(sent["capture"]["method"], "none");
        assert_eq!(sent["capture"]["readRate"].as_f64(), Some(0.0));
        assert!(
            schema("heartbeat.json").is_valid(&sent),
            "the body matches its schema"
        );
    }

    #[test]
    fn every_screen_is_sent_under_its_contract_word() {
        for (screen, word) in [
            (Screen::Unknown, "UNKNOWN"),
            (Screen::CharacterSelect, "CHARACTER_SELECT"),
            (Screen::InGame, "IN_GAME"),
            (Screen::AutomapOpen, "AUTOMAP_OPEN"),
        ] {
            let presence = Presence {
                game_running: true,
                screen,
            };
            let sent = serde_json::to_value(
                heartbeat_from_presence(&presence, "0.0.1").expect("a contract heartbeat"),
            )
            .expect("the heartbeat serializes");
            assert_eq!(sent["game"]["screen"], word, "{screen:?}");
            assert!(
                schema("heartbeat.json").is_valid(&sent),
                "{screen:?} matches the schema"
            );
        }
    }

    #[test]
    fn cards_are_sent_in_the_batch_shape_and_match_the_schema() {
        let cards = [
            Card::new(
                "Sorc",
                Class::Sorceress,
                85,
                Mode::Softcore,
                LadderFlag::Ladder,
                Era::Lod,
                Some(Title::Lord),
            )
            .expect("the card builds"),
            Card::new(
                "Hammer",
                Class::Paladin,
                92,
                Mode::Hardcore,
                LadderFlag::NonLadder,
                Era::Rotw,
                None,
            )
            .expect("the card builds"),
        ];

        let sent = serde_json::to_value(characters_to_contract(&cards).expect("a contract batch"))
            .expect("the batch serializes");

        assert_eq!(sent["characters"][0]["name"], "Sorc");
        assert_eq!(sent["characters"][0]["class"], "sorceress");
        assert_eq!(sent["characters"][0]["ladder"], "sc-ladder");
        assert_eq!(sent["characters"][0]["era"], "lod");
        assert_eq!(
            sent["characters"][0]["unlockedDifficulties"],
            json!(["normal", "nightmare", "hell"])
        );
        assert_eq!(sent["characters"][1]["ladder"], "hc-nonladder");
        assert_eq!(
            sent["characters"][1]["unlockedDifficulties"],
            json!(["normal"])
        );
        assert!(
            schema("record-characters-request.json").is_valid(&sent),
            "the batch matches its schema"
        );
    }

    #[test]
    fn unknown_screen_and_stopped_game_are_sent_as_such() {
        let presence = Presence {
            game_running: false,
            screen: Screen::Unknown,
        };

        let sent = serde_json::to_value(
            heartbeat_from_presence(&presence, "0.0.1").expect("a contract heartbeat"),
        )
        .expect("the heartbeat serializes");

        assert_eq!(sent["game"]["running"], false);
        assert_eq!(sent["game"]["screen"], "UNKNOWN");
    }

    #[test]
    fn observation_translation_matches_the_contract() {
        let observation = GameNameObservation {
            room: ROOM.parse::<Uuid>().expect("a UUID room"),
            run: nonzero(3),
            key: Uuid::from_u128(7),
            game_name: "mmbaalh-12".into(),
            confidence: 0.93,
            captured_at: now(),
        };

        let sent = serde_json::to_value(
            observation_to_contract(&observation).expect("a contract observation"),
        )
        .expect("the observation serializes");

        assert_eq!(sent["idempotencyKey"], Uuid::from_u128(7).to_string());
        assert_eq!(sent["type"], "GAME_NAME_SEEN");
        assert_eq!(sent["run"], 3);
        assert_eq!(sent["value"], "mmbaalh-12");
        assert_eq!(sent["confidence"], 0.93);
        assert_eq!(sent["capturedAt"], "2026-10-31T10:00:00Z");
        assert!(
            schema("observation.json").is_valid(&sent),
            "the body matches its schema"
        );
    }

    #[test]
    fn non_uuid_room_is_carried_unchanged() {
        let message = assignment_from_contract(contract_assignment("not-a-room"));
        assert_eq!(message.room.as_str(), "not-a-room");

        let back = assignment_to_contract(&message).expect("the message translates back");
        assert_eq!(back.room_id.as_str(), "not-a-room");
    }

    #[test]
    fn pairing_response_translation_keeps_code_expiry_and_secret() {
        let response: contract::PairingCodeResponse = serde_json::from_value(json!({
            "code": "123456",
            "expiresAt": "2026-11-01T10:05:00Z",
            "claimSecret": "claim-secret-7f3a9c1e5b2d",
        }))
        .expect("a contract pairing code");

        let issued = issued_code_from_contract(response).expect("six digits");

        assert_eq!(issued.code.as_str(), "123456");
        assert_eq!(
            issued.expires_at,
            "2026-11-01T10:05:00Z"
                .parse::<DateTime<Utc>>()
                .expect("a valid instant")
        );
        assert_eq!(issued.claim_secret.expose(), "claim-secret-7f3a9c1e5b2d");
    }

    #[test]
    fn heartbeat_body_follows_the_contract() {
        let presence = Presence {
            game_running: true,
            screen: Screen::Unknown,
        };
        let body = heartbeat_from_presence(&presence, "0.0.1").expect("a contract body");
        let sent = serde_json::to_value(&body).expect("the body serializes");
        assert_eq!(sent["game"]["screen"], "UNKNOWN");
        assert_eq!(sent["game"]["running"].as_bool(), Some(true));
        assert_eq!(sent["agentVersion"], "0.0.1");
        assert!(heartbeat_from_presence(&presence, "not-a-version").is_err());
    }

    /// A fused observation carries exactly the wire keys, the `GAME_NAME_SEEN` type and a body that matches its schema
    /// (AD-052). No image travels with it (AGS-20).
    #[test]
    fn observation_carries_no_image() {
        let observation = GameNameObservation {
            room: ROOM.parse::<Uuid>().expect("a UUID room"),
            run: nonzero(3),
            key: Uuid::from_u128(1),
            game_name: "mmbaalh-12".into(),
            confidence: 0.93,
            captured_at: now(),
        };
        let sent = serde_json::to_value(
            observation_to_contract(&observation).expect("a contract observation"),
        )
        .expect("the observation serializes");

        let keys: BTreeSet<&str> = sent
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            BTreeSet::from([
                "capturedAt",
                "confidence",
                "idempotencyKey",
                "run",
                "type",
                "value"
            ])
        );
        assert_eq!(sent["type"], "GAME_NAME_SEEN");
        assert!(
            schema("observation.json").is_valid(&sent),
            "the body matches its schema"
        );
    }
}
