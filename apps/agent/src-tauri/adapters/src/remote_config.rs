//! The remote configuration's body, read tolerantly (remote-config RCF-02, RCF-05, RCF-10): the adapter turns bytes into the
//! domain's `Wire` (a closed set of typed fields) and the domain's `from_wire` clamps and decides. The body is never kept: a
//! field the agent does not know is not carried, a field of the wrong type is `None`, and nothing in it is interpreted.

use d2rmm_agent_core::ports::ConfigReader;
use d2rmm_agent_domain::remote_config::{Wire, WireArea, WireWords, body_fits};
use serde_json::Value;

/// The reader the agent runs with: bytes to the closed set of fields (RCF-02).
#[derive(Debug, Default, Clone, Copy)]
pub struct WireReader;

impl ConfigReader for WireReader {
    fn read(&self, body: &[u8]) -> Option<Wire> {
        wire_of(body)
    }
}

/// What the agent read from a body: `None` when the body is over the size limit or is not a JSON object.
pub fn wire_of(body: &[u8]) -> Option<Wire> {
    if !body_fits(body.len()) {
        return None;
    }
    let Value::Object(document) = serde_json::from_slice::<Value>(body).ok()? else {
        return None;
    };
    let cadence = document.get("cadence");
    let thresholds = document.get("thresholds");
    let regions = document.get("regions");
    let phrases = document.get("phrases");
    Some(Wire {
        version: number(document.get("version")),
        demote_after: number(field(cadence, "demoteAfter")),
        probe_every: number(field(cadence, "probeEvery")),
        rate_window: number(field(cadence, "rateWindow")),
        look_interval_ms: number(field(cadence, "lookIntervalMs")),
        automap_search_every: number(field(cadence, "automapSearchEvery")),
        list_search_every: number(field(cadence, "listSearchEvery")),
        track_pad: number(field(thresholds, "trackPad")),
        hud_band: area(field(regions, "hudBand")),
        automap_area: area(field(regions, "automapArea")),
        party_area: area(field(regions, "partyArea")),
        en: words(field(phrases, "en")),
        pt_br: words(field(phrases, "pt-BR")),
    })
}

fn field<'a>(section: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    section?.as_object()?.get(name)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64()
}

fn text(value: Option<&Value>) -> Option<String> {
    value?.as_str().map(str::to_string)
}

fn area(value: Option<&Value>) -> Option<WireArea> {
    value?.as_object()?;
    Some(WireArea {
        x: number(field(value, "x")),
        y: number(field(value, "y")),
        width: number(field(value, "width")),
        height: number(field(value, "height")),
    })
}

fn words(value: Option<&Value>) -> WireWords {
    WireWords {
        party: text(field(value, "party")),
        game_name: text(field(value, "gameName")),
        password: text(field(value, "password")),
        joined_game: text(field(value, "joinedGame")),
        left_game: text(field(value, "leftGame")),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use d2rmm_agent_domain::language::LanguagePack;
    use d2rmm_agent_domain::remote_config::{Effective, FIELDS, Verdict, Words, from_wire};
    use serde_json::json;

    use super::wire_of;
    use crate::contracts::generated::AgentConfig;
    use crate::language::parse_pack;

    fn body(value: &serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(value).expect("a document")
    }

    /// The document the API serves, read from the repository (RCF-12): the file the defaults are pinned against.
    fn committed() -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../api/src/modules/agents/config/agent-config.json");
        std::fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }

    #[test]
    fn the_committed_document_is_a_valid_agent_config_of_the_generated_contract() {
        let parsed: AgentConfig = serde_json::from_slice(&committed()).expect("the contract type");
        assert_eq!(parsed.version.get(), 1);
    }

    /// RCF-07: every value of the committed document equals the agent's built-in default (the constants it replaces).
    #[test]
    fn the_committed_document_equals_the_built_in_defaults() {
        let wire = wire_of(&committed()).expect("a document");
        let Verdict::Applied(applied) = from_wire(Some(&wire), 0) else {
            panic!("the committed document is a newer version than the built-in 0");
        };
        let built_in = Effective::built_in();
        assert_eq!(applied.version, 1);
        assert_eq!(applied.cadence, built_in.cadence);
        assert_eq!(applied.thresholds, built_in.thresholds);
        assert_eq!(applied.regions, built_in.regions);
        // The phrases are the shipped English words (`resources/lang/en.json`), which the built-in pack holds.
        let english =
            parse_pack(include_str!("../../resources/lang/en.json")).expect("the English file");
        assert_eq!(english, LanguagePack::english());
        assert_eq!(
            applied.phrases.en,
            Words {
                party: Some("Party".into()),
                game_name: Some("Game Name".into()),
                password: Some("Password".into()),
                ..Words::default()
            }
        );
        assert_eq!(applied.phrases.pt_br, Words::default());
    }

    #[test]
    fn the_defaults_equal_the_capture_cascade_constants_they_replace() {
        use d2rmm_agent_domain::capture_cascade::{DEMOTE_AFTER, PROBE_EVERY, RATE_WINDOW};
        let cadence = Effective::built_in().cadence;
        assert_eq!(cadence.demote_after, DEMOTE_AFTER);
        assert_eq!(cadence.probe_every, PROBE_EVERY);
        assert_eq!(usize::try_from(cadence.rate_window), Ok(RATE_WINDOW));
    }

    #[test]
    fn an_unknown_field_is_not_carried_and_the_rest_is_read() {
        let wire = wire_of(&body(&json!({
            "version": 2, "runThis": true, "cadence": { "probeEvery": 30, "launch": "calc" },
        })))
        .expect("a document");
        assert_eq!(wire.probe_every, Some(30.0));
        assert_eq!(wire.demote_after, None);
    }

    #[test]
    fn a_field_of_the_wrong_type_is_none_and_the_others_stay() {
        let wire = wire_of(&body(&json!({
            "version": 2,
            "cadence": { "probeEvery": "30", "demoteAfter": 4 },
            "thresholds": 5,
            "regions": { "hudBand": [1, 2], "partyArea": { "x": 0.1, "y": "no", "width": 0.5, "height": 0.5 } },
            "phrases": { "en": { "party": 7, "gameName": "Game Name" }, "pt-BR": "x" },
        })))
        .expect("a document");
        assert_eq!(wire.probe_every, None);
        assert_eq!(wire.demote_after, Some(4.0));
        assert_eq!(wire.track_pad, None);
        assert_eq!(wire.hud_band, None);
        assert_eq!(wire.party_area.map(|area| area.y), Some(None));
        assert_eq!(wire.en.party, None);
        assert_eq!(wire.en.game_name.as_deref(), Some("Game Name"));
        assert_eq!(wire.pt_br.party, None);
    }

    #[test]
    fn a_value_outside_its_range_reaches_the_domain_untouched() {
        let wire = wire_of(&body(
            &json!({ "version": 2, "cadence": { "probeEvery": -5 } }),
        ))
        .expect("a document");
        assert_eq!(wire.probe_every, Some(-5.0));
    }

    #[test]
    fn a_body_that_is_not_a_json_object_or_is_too_large_is_none() {
        assert_eq!(wire_of(b"{\"version\": 6, \"cadence\": {"), None);
        assert_eq!(wire_of(b""), None);
        assert_eq!(wire_of(b"[1]"), None);
        assert_eq!(wire_of(b"7"), None);
        assert_eq!(wire_of(b"null"), None);
        let mut big = br#"{"version": 2, "pad": ""#.to_vec();
        big.resize(65_536, b'a');
        big.extend_from_slice(b"\"}");
        assert_eq!(wire_of(&big), None);
        let mut at_the_limit = br#"{"version":2,"pad":""#.to_vec();
        at_the_limit.resize(65_534, b'a');
        at_the_limit.extend_from_slice(b"\"}");
        assert_eq!(at_the_limit.len(), 65_536);
        assert!(wire_of(&at_the_limit).is_some());
    }

    /// The leaf fields of a schema, by dotted path; a region (four fractions) counts as one field.
    fn leaf_paths(schema: &serde_json::Value, prefix: &str, found: &mut Vec<String>) {
        let Some(properties) = schema.get("properties").and_then(|value| value.as_object()) else {
            found.push(prefix.to_string());
            return;
        };
        let is_region = ["x", "y", "width", "height"]
            .iter()
            .all(|side| properties.contains_key(*side));
        if is_region {
            found.push(prefix.to_string());
            return;
        }
        for (name, child) in properties {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}.{name}")
            };
            leaf_paths(child, &path, found);
        }
    }

    /// RCF-10: the fields the contract carries are exactly the fields the agent reads (`FIELDS`). A new field in the contract
    /// fails this test until the agent's rules and this list are reviewed together.
    #[test]
    fn the_fields_of_the_contract_are_the_fields_the_agent_reads() {
        let (_, text) = crate::contracts::schemas::SCHEMAS
            .iter()
            .find(|(name, _)| *name == "agent-config.json")
            .expect("the schema of the configuration");
        let schema: serde_json::Value = serde_json::from_str(text).expect("a schema");
        let mut found = Vec::new();
        leaf_paths(&schema, "", &mut found);
        found.sort();
        let mut read: Vec<String> = FIELDS.iter().map(ToString::to_string).collect();
        read.sort();
        assert_eq!(found, read);
        assert_eq!(
            schema["additionalProperties"], false,
            "the contract is closed"
        );
    }

    /// Every field of the list is read from a body that sets it, under the name the contract gives it.
    #[test]
    fn every_field_the_agent_reads_is_read_from_its_wire_name() {
        let region = |x: f64| json!({ "x": x, "y": 0.1, "width": 0.3, "height": 0.3 });
        let wire = wire_of(&body(&json!({
            "version": 9,
            "cadence": { "demoteAfter": 1, "probeEvery": 2, "rateWindow": 3, "lookIntervalMs": 4,
                "automapSearchEvery": 6, "listSearchEvery": 7 },
            "thresholds": { "trackPad": 5 },
            "regions": { "hudBand": region(0.1), "automapArea": region(0.2), "partyArea": region(0.3) },
            "phrases": {
                "en": { "party": "a", "gameName": "b", "password": "c", "joinedGame": "g", "leftGame": "h" },
                "pt-BR": { "party": "d", "gameName": "e", "password": "f", "joinedGame": "i", "leftGame": "j" },
            },
        })))
        .expect("a document");
        assert_eq!(wire.version, Some(9.0));
        assert_eq!(
            [
                wire.demote_after,
                wire.probe_every,
                wire.rate_window,
                wire.look_interval_ms,
                wire.track_pad,
                wire.automap_search_every,
                wire.list_search_every
            ],
            [
                Some(1.0),
                Some(2.0),
                Some(3.0),
                Some(4.0),
                Some(5.0),
                Some(6.0),
                Some(7.0)
            ]
        );
        let x = |area: Option<d2rmm_agent_domain::remote_config::WireArea>| area.and_then(|a| a.x);
        assert_eq!(
            [x(wire.hud_band), x(wire.automap_area), x(wire.party_area)],
            [Some(0.1), Some(0.2), Some(0.3)]
        );
        let area = wire.hud_band.expect("an area");
        assert_eq!(
            (area.y, area.width, area.height),
            (Some(0.1), Some(0.3), Some(0.3))
        );
        let words = |w: &d2rmm_agent_domain::remote_config::WireWords| {
            [
                w.party.clone(),
                w.game_name.clone(),
                w.password.clone(),
                w.joined_game.clone(),
                w.left_game.clone(),
            ]
        };
        assert_eq!(
            words(&wire.en),
            ["a", "b", "c", "g", "h"].map(|word| Some(word.into()))
        );
        assert_eq!(
            words(&wire.pt_br),
            ["d", "e", "f", "i", "j"].map(|word| Some(word.into()))
        );
    }
}
