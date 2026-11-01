//! Fusion: a read game name becomes a `GAME_NAME_SEEN` observation only when it names the assigned room exactly (design.md
//! § Vision and fusion; AGS-17, AGS-18, AGS-20; AD-052). Any other name, or no assignment, yields nothing.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::messages::{Assignment, GameNameObservation};
use crate::ports::{IdGenerator, ReadText};

/// A `GAME_NAME_SEEN` observation and the room whose endpoint receives it.
#[derive(Debug, Clone)]
pub struct Fusion {
    pub room: Uuid,
    pub observation: GameNameObservation,
}

/// Accepts the read only when its text, trimmed and lower-cased, equals the expected game name lower-cased (AD-052). The
/// observation carries that normalised text, the assignment's run and room, a clamped confidence, a new idempotency key
/// and the capture time.
pub fn fuse(
    read: &ReadText,
    assignment: &Assignment,
    now_utc: DateTime<Utc>,
    ids: &dyn IdGenerator,
) -> Option<Fusion> {
    let seen = read.text.trim().to_lowercase();
    if seen != assignment.expected_game_name.as_str().to_lowercase() {
        return None;
    }
    let room = Uuid::parse_str(assignment.room.as_str()).ok()?;
    let confidence = if read.confidence.is_nan() {
        0.0
    } else {
        read.confidence.clamp(0.0, 1.0)
    };
    let observation = GameNameObservation {
        room,
        run: assignment.run,
        key: ids.idempotency_key(),
        game_name: seen,
        confidence,
        captured_at: now_utc,
    };
    Some(Fusion { room, observation })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::Mutex;

    use chrono::{DateTime, Utc};
    use serde_json::{Value, json};
    use uuid::Uuid;

    use super::{Fusion, fuse};
    use crate::gateway::translate::{assignment_from_contract, observation_to_contract};
    use crate::messages::{Assignment, GameNameObservation};
    use crate::ports::{ReadError, ReadText, Region, Rgba, SequentialIds, TextReader};
    use crate::vision::{AUTOMAP_NAME_1080P, read_game_name};

    const ROOM: &str = "7d9f2c1e-0000-4000-8000-000000000001";
    const OBSERVATION_SCHEMA: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../packages/contracts/json-schema/observation.json"
    );

    /// Returns the same text for any region and remembers the regions it was asked to read.
    struct FixedReader {
        text: String,
        regions: Mutex<Vec<Region>>,
    }

    impl FixedReader {
        fn reading(text: &str) -> Self {
            Self {
                text: text.to_string(),
                regions: Mutex::new(Vec::new()),
            }
        }
    }

    impl TextReader for FixedReader {
        fn read(&self, _image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
            self.regions.lock().expect("the regions lock").push(region);
            Ok(ReadText {
                text: self.text.clone(),
                confidence: 0.93,
            })
        }
    }

    fn assignment() -> Assignment {
        let contract: crate::contracts::generated::Assignment = serde_json::from_value(json!({
            "roomId": ROOM,
            "run": 3,
            "expectedGameName": "mmbaalh-12",
            "members": [{ "accountId": "account-1", "characterId": null, "joinOrder": 1, "role": "host" }],
        }))
        .expect("a contract assignment");
        assignment_from_contract(contract)
    }

    /// The observation as the wire carries it: its translation to the contract shape, as JSON.
    fn wire(observation: &GameNameObservation) -> Value {
        let body =
            observation_to_contract(observation).expect("the observation has its contract shape");
        serde_json::to_value(body).expect("the body serializes")
    }

    fn now() -> DateTime<Utc> {
        "2026-10-31T10:00:00Z".parse().expect("a valid instant")
    }

    fn read(text: &str, confidence: f64) -> ReadText {
        ReadText {
            text: text.to_string(),
            confidence,
        }
    }

    fn fused(text: &str) -> Option<Fusion> {
        fuse(
            &read(text, 0.93),
            &assignment(),
            now(),
            &SequentialIds::new(),
        )
    }

    #[test]
    fn reads_first_line_of_region() {
        let reader = FixedReader::reading("mmbaalh-12\nDifficulty: Hell");
        let frame = Rgba {
            width: 1920,
            height: 1080,
            pixels: Vec::new(),
        };

        let read = read_game_name(&frame, &reader).expect("the built-in region reads");

        assert_eq!(read.text, "mmbaalh-12");
        assert_eq!(
            *reader.regions.lock().expect("the regions lock"),
            vec![AUTOMAP_NAME_1080P]
        );
    }

    #[test]
    fn unsupported_resolution_reads_nothing() {
        let reader = FixedReader::reading("mmbaalh-12");
        let frame = Rgba {
            width: 1280,
            height: 720,
            pixels: Vec::new(),
        };

        assert_eq!(read_game_name(&frame, &reader), Err(ReadError::Failed));
        assert!(reader.regions.lock().expect("the regions lock").is_empty());
    }

    #[test]
    fn exact_match_yields_one_observation() {
        let ids = SequentialIds::new();
        let expected = assignment();
        let mut keys = Vec::new();
        for seen in ["mmbaalh-12", "MMBAALH-12 "] {
            let fusion = fuse(&read(seen, 0.93), &expected, now(), &ids)
                .expect("the normalised name matches");
            let observation = &fusion.observation;

            assert_eq!(fusion.room, ROOM.parse::<Uuid>().expect("a UUID room"));
            assert_eq!(wire(observation)["type"], "GAME_NAME_SEEN");
            assert_eq!(observation.game_name, "mmbaalh-12", "normalised value");
            assert_eq!(observation.run.get(), 3, "the assignment's run");
            assert!((0.0..=1.0).contains(&observation.confidence));
            assert_eq!(observation.captured_at, now(), "the capture time");
            keys.push(observation.key.to_string());
        }
        assert_ne!(keys[0], keys[1], "each observation has a new key");
    }

    #[test]
    fn other_names_yield_none() {
        for seen in ["mmbaalh-13", "mmbaalh-1", " mmbaalh-12x", ""] {
            assert!(fused(seen).is_none(), "{seen:?} must not match");
        }
    }

    #[test]
    fn observation_carries_no_image() {
        let fusion = fused("mmbaalh-12").expect("the name matches");
        let sent = wire(&fusion.observation);

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
        let schema: Value = serde_json::from_str(
            &std::fs::read_to_string(OBSERVATION_SCHEMA).expect("the observation schema"),
        )
        .expect("the schema is JSON");
        let validator = jsonschema::validator_for(&schema).expect("the schema compiles");
        assert!(validator.is_valid(&sent), "the body matches its schema");
    }

    #[test]
    fn confidence_is_clamped_into_the_unit_interval() {
        let high = fuse(
            &read("mmbaalh-12", 1.7),
            &assignment(),
            now(),
            &SequentialIds::new(),
        )
        .expect("the name matches");
        let missing = fuse(
            &read("mmbaalh-12", f64::NAN),
            &assignment(),
            now(),
            &SequentialIds::new(),
        )
        .expect("the name matches");

        assert!((high.observation.confidence - 1.0).abs() < 1e-12);
        assert!(missing.observation.confidence.abs() < 1e-12);
    }
}
