//! The sanitizer of the agent's spans (OBS-28, OBS-30, design § Agent exporter). It runs before the queue and the relay, so
//! a window title, a process path, screen text, a URL or a local path never leaves the machine. A Rust error text can hold
//! a full URL or a `C:\Users\<name>` path, so every event, every link and the status description go too.

use std::borrow::Cow;
use std::future::Future;
use std::time::Duration;

use opentelemetry::trace::Status;
use opentelemetry::{Array, KeyValue, Value};
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks};

use super::tier::TelemetryTier;

/// The longest string value a span keeps, in characters (design § Agent exporter).
pub const MAX_STRING_CHARS: usize = 128;
/// Span names must start with this prefix; any other span is dropped.
pub const SPAN_NAME_PREFIX: &str = "agent.";
/// The only attribute keys a span keeps. The match is exact: `http.url` is not `http.request.method`.
pub const ALLOWED_ATTRIBUTE_KEYS: [&str; 21] = [
    "vision.screen",
    "vision.search",
    "vision.area_class",
    "capture.method",
    "capture.outcome",
    "config.outcome",
    "config.version",
    "post.outcome",
    "status",
    "d2r.room.id",
    "d2r.agent.version",
    "d2r.difficulty",
    "d2r.queue.mode",
    "http.request.method",
    "http.response.status_code",
    // OBT-05, both tiers: the ids and the game data of the journey, how sure the read was, the correction classes applied
    // and the time of a step. Never a name and never the text read.
    "d2r.agent.id",
    "d2r.run.id",
    "d2r.game.name",
    "d2r.ocr.confidence",
    "d2r.ocr.corrections",
    "d2r.step.duration_ms",
];
/// The attribute keys only the full tier keeps (OBT-06, OBT-08): the text the OCR read and every name read on screen. In
/// the production tier these are dropped by key, whatever the value. The agent's spans set them through the full-tier
/// helpers only (OBT-10).
pub const FULL_TIER_KEYS: [&str; 4] = [
    "d2r.ocr.text",
    "d2r.ocr.names",
    "d2r.character.name",
    "d2r.account.battletag",
];
/// The values a vision attribute may carry (screen-recognition T8, SCR-09): fixed words, never a coordinate, a read text or a
/// pixel. Any other value of these keys is dropped with its key.
pub const VISION_VALUES: [(&str, &[&str]); 7] = [
    (
        "vision.screen",
        &["in_game", "automap", "character_select", "unknown"],
    ),
    (
        "vision.search",
        &["track", "band", "fixed", "none", "rested", "lifted"],
    ),
    ("vision.area_class", &["box", "band", "panel"]),
    // The capture cascade's span (capture-cascade CAP-08): the method and what the capture gave, never a size or a title.
    (
        "capture.method",
        &["print-window", "graphics-capture", "screen-crop", "none"],
    ),
    ("capture.outcome", &["frame", "blank", "failed", "skipped"]),
    // The configuration fetch's span (remote-config RCF-11): how the fetch ended, never a body or a value.
    (
        "config.outcome",
        &["applied", "unchanged", "invalid", "stale", "unreachable"],
    ),
    // The other-game post's span (`agent.other_game.post`): whether the post went through, never a body or an error text.
    ("post.outcome", &["posted", "failed"]),
];

/// The configuration version a span may carry (RCF-11): a whole number from 0 (the built-in defaults) to the largest the agent
/// takes. Anything else, a text included, is dropped with its key.
const CONFIG_VERSION_KEY: &str = "config.version";
const CONFIG_VERSION_MAX: i64 = 2_147_483_647;

const CONFIDENCE_KEY: &str = "d2r.ocr.confidence";
const CORRECTIONS_KEY: &str = "d2r.ocr.corrections";
const DURATION_KEY: &str = "d2r.step.duration_ms";
const GAME_NAME_KEY: &str = "d2r.game.name";
/// The longest a step may take and still be a timing: one hour in milliseconds.
const DURATION_MAX_MS: i64 = 3_600_000;
/// The longest correction class, in characters (`rn>m`): a longer value could carry a read name.
const CORRECTION_CLASS_MAX_CHARS: usize = 8;
/// The longest generated game name (`mm{activity}{difficulty}-{n}`, ADR 017).
const GAME_NAME_MAX_CHARS: usize = 32;

/// Whether `text` is a generated game name: `mm`, then lowercase letters, digits and hyphens, so a player's name under this
/// key (capitals, spaces, other marks) is dropped.
fn is_generated_game_name(text: &str) -> bool {
    text.starts_with("mm")
        && text.chars().count() <= GAME_NAME_MAX_CHARS
        && text
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Whether `text` is a list of correction classes: comma-separated `from>to` pairs, each short (OBT-05).
fn is_correction_list(text: &str) -> bool {
    !text.is_empty()
        && text.split(',').all(|class| {
            class.chars().count() <= CORRECTION_CLASS_MAX_CHARS
                && class.matches('>').count() == 1
                && class.chars().all(|c| c.is_ascii_alphanumeric() || c == '>')
        })
}

/// Whether an attribute may leave the machine in `tier`: its key is allowed (a full-tier key only in the full tier) and,
/// for a key with a fixed shape, its value has that shape.
fn attribute_allowed(attribute: &KeyValue, tier: TelemetryTier) -> bool {
    let key = attribute.key.as_str();
    if FULL_TIER_KEYS.contains(&key) {
        return tier == TelemetryTier::Full;
    }
    if !ALLOWED_ATTRIBUTE_KEYS.contains(&key) {
        return false;
    }
    match (key, &attribute.value) {
        (CONFIDENCE_KEY, Value::F64(confidence)) => return (0.0..=1.0).contains(confidence),
        (CONFIDENCE_KEY, _) => return false,
        (CORRECTIONS_KEY, Value::String(text)) => return is_correction_list(text.as_str()),
        (CORRECTIONS_KEY, _) => return false,
        (DURATION_KEY, Value::I64(ms)) => return (0..=DURATION_MAX_MS).contains(ms),
        (DURATION_KEY, _) => return false,
        (GAME_NAME_KEY, Value::String(text)) => return is_generated_game_name(text.as_str()),
        (GAME_NAME_KEY, _) => return false,
        _ => {}
    }
    if key == CONFIG_VERSION_KEY {
        return matches!(&attribute.value, Value::I64(version) if (0..=CONFIG_VERSION_MAX).contains(version));
    }
    match VISION_VALUES.iter().find(|(name, _)| *name == key) {
        None => true,
        Some((_, words)) => {
            matches!(&attribute.value, Value::String(text) if words.contains(&text.as_str()))
        }
    }
}

/// The only resource attributes the exporter sends.
pub const ALLOWED_RESOURCE_KEYS: [&str; 5] = [
    "service.name",
    "service.version",
    "deployment.environment",
    "d2r.agent.version",
    "d2r.telemetry.tier",
];

/// Sanitizes one span for `tier`. A span whose name does not start with `agent.` is dropped (`None`). Events, links, status
/// text, URLs, paths and window titles go in every tier; credentials are on no list, so they never leave (OBT-11).
pub fn sanitize_span(span: SpanData, tier: TelemetryTier) -> Option<SpanData> {
    if !span.name.starts_with(SPAN_NAME_PREFIX) {
        return None;
    }
    let attributes = span
        .attributes
        .into_iter()
        .filter(|attribute| attribute_allowed(attribute, tier))
        .map(|attribute| KeyValue::new(attribute.key, truncate_value(attribute.value)))
        .collect();
    Some(SpanData {
        attributes,
        dropped_attributes_count: 0,
        events: SpanEvents::default(),
        links: SpanLinks::default(),
        status: without_status_text(span.status),
        ..span
    })
}

/// Keeps the five resource attributes the exporter sends and no other.
pub fn sanitize_resource_key(key: &str) -> bool {
    ALLOWED_RESOURCE_KEYS.contains(&key)
}

fn truncate_value(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(truncate(text.as_str()).into()),
        Value::Array(Array::String(items)) => Value::Array(Array::String(
            items
                .iter()
                .map(|item| truncate(item.as_str()).into())
                .collect(),
        )),
        other => other,
    }
}

fn truncate(text: &str) -> String {
    text.chars().take(MAX_STRING_CHARS).collect()
}

fn without_status_text(status: Status) -> Status {
    match status {
        Status::Error { .. } => Status::Error {
            description: Cow::Borrowed(""),
        },
        other => other,
    }
}

/// Sanitizes each span of a batch, then exports what is left through the wrapped exporter.
#[derive(Debug)]
pub struct SanitizingExporter<E> {
    inner: E,
    tier: TelemetryTier,
}

impl<E> SanitizingExporter<E> {
    pub fn new(inner: E, tier: TelemetryTier) -> Self {
        Self { inner, tier }
    }
}

impl<E: SpanExporter> SpanExporter for SanitizingExporter<E> {
    fn export(&self, batch: Vec<SpanData>) -> impl Future<Output = OTelSdkResult> + Send {
        let tier = self.tier;
        let clean: Vec<SpanData> = batch
            .into_iter()
            .filter_map(|span| sanitize_span(span, tier))
            .collect();
        self.inner.export(clean)
    }

    fn shutdown_with_timeout(&self, timeout: Duration) -> OTelSdkResult {
        self.inner.shutdown_with_timeout(timeout)
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::time::{Duration, SystemTime};

    use opentelemetry::trace::{
        Event, Link, SpanContext, SpanId, SpanKind, Status, TraceFlags, TraceId, TraceState,
    };
    use std::future::Future;
    use std::sync::{Arc, Mutex};

    use opentelemetry::{Array, InstrumentationScope, KeyValue, Value};
    use opentelemetry_sdk::error::OTelSdkResult;
    use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks};

    use super::{
        ALLOWED_ATTRIBUTE_KEYS, ALLOWED_RESOURCE_KEYS, FULL_TIER_KEYS, MAX_STRING_CHARS,
        SanitizingExporter, TelemetryTier, sanitize_resource_key,
    };

    /// The production tier, which the older tests below were written for.
    fn sanitize_span(span: SpanData) -> Option<SpanData> {
        super::sanitize_span(span, TelemetryTier::Production)
    }

    /// Keeps what it is given, so a test reads the batch the wrapped exporter received.
    #[derive(Debug, Clone, Default)]
    struct Recording(Arc<Mutex<Vec<SpanData>>>);

    impl SpanExporter for Recording {
        fn export(&self, batch: Vec<SpanData>) -> impl Future<Output = OTelSdkResult> + Send {
            self.0.lock().expect("the recording").extend(batch);
            async { Ok(()) }
        }
    }

    fn span(name: &'static str, attributes: Vec<KeyValue>, status: Status) -> SpanData {
        let context = SpanContext::new(
            TraceId::from_hex("4bf92f3577b34da6a3ce929d0e0e4736").expect("a trace id"),
            SpanId::from_hex("00f067aa0ba902b7").expect("a span id"),
            TraceFlags::SAMPLED,
            false,
            TraceState::default(),
        );
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        SpanData {
            span_context: context,
            parent_span_id: SpanId::INVALID,
            parent_span_is_remote: false,
            span_kind: SpanKind::Client,
            name: Cow::Borrowed(name),
            start_time: now,
            end_time: now,
            attributes,
            dropped_attributes_count: 0,
            events: SpanEvents::default(),
            links: SpanLinks::default(),
            status,
            instrumentation_scope: InstrumentationScope::builder("d2rmm-agent").build(),
        }
    }

    fn keys(span: &SpanData) -> Vec<String> {
        span.attributes
            .iter()
            .map(|attribute| attribute.key.as_str().to_string())
            .collect()
    }

    #[test]
    fn the_search_words_of_a_rested_or_lifted_frame_are_kept_and_others_dropped() {
        for word in ["track", "band", "fixed", "none", "rested", "lifted"] {
            let kept = sanitize_span(span(
                "agent.vision.read",
                vec![KeyValue::new("vision.search", word)],
                Status::Unset,
            ))
            .expect("an agent span is kept");
            assert_eq!(keys(&kept), ["vision.search"], "{word}");
        }
        for word in ["searched", "tracked", "Rested", "lifted "] {
            let dropped = sanitize_span(span(
                "agent.vision.read",
                vec![KeyValue::new("vision.search", word)],
                Status::Unset,
            ))
            .expect("an agent span is kept");
            assert!(keys(&dropped).is_empty(), "{word}");
        }
    }

    #[test]
    fn a_vision_attribute_keeps_only_its_fixed_words() {
        let fixture = span(
            "agent.vision.read",
            vec![
                KeyValue::new("vision.screen", "in_game"),
                KeyValue::new("vision.search", "band"),
                KeyValue::new("vision.area_class", "panel"),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(fixture).expect("an agent span is kept");
        assert_eq!(
            keys(&clean),
            ["vision.screen", "vision.search", "vision.area_class"]
        );
        let other = span(
            "agent.vision.read",
            vec![
                KeyValue::new("vision.screen", "Level 88 Sorceress"),
                KeyValue::new("vision.search", "1650,882"),
                KeyValue::new("vision.area_class", 7_i64),
                KeyValue::new("vision.text", "mmbaalm-99"),
                KeyValue::new("status", "ok"),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(other).expect("an agent span is kept");
        assert_eq!(
            keys(&clean),
            ["status"],
            "any other value goes with its key"
        );
    }

    #[test]
    fn a_capture_attribute_keeps_only_its_fixed_words() {
        let words = span(
            "agent.vision.capture",
            vec![
                KeyValue::new("capture.method", "graphics-capture"),
                KeyValue::new("capture.outcome", "blank"),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(words).expect("an agent span is kept");
        assert_eq!(keys(&clean), ["capture.method", "capture.outcome"]);
        // Every method and outcome word is kept, and nothing else: a size, a title, a path, a number.
        for method in ["print-window", "graphics-capture", "screen-crop", "none"] {
            let one = span(
                "agent.vision.capture",
                vec![KeyValue::new("capture.method", method)],
                Status::Unset,
            );
            assert_eq!(keys(&sanitize_span(one).expect("kept")), ["capture.method"]);
        }
        for outcome in ["frame", "blank", "failed", "skipped"] {
            let one = span(
                "agent.vision.capture",
                vec![KeyValue::new("capture.outcome", outcome)],
                Status::Unset,
            );
            assert_eq!(
                keys(&sanitize_span(one).expect("kept")),
                ["capture.outcome"]
            );
        }
        let other = span(
            "agent.vision.capture",
            vec![
                KeyValue::new("capture.method", "1936x1063"),
                KeyValue::new("capture.outcome", "Diablo II Resurrected - Alice"),
                KeyValue::new("capture.size", "1920x1080"),
                KeyValue::new("capture.window", "D2R"),
                KeyValue::new("capture.method.extra", "print-window"),
                KeyValue::new("capture.outcome", 3_i64),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(other).expect("an agent span is kept");
        assert!(keys(&clean).is_empty(), "{:?}", keys(&clean));
    }

    #[test]
    fn keeps_the_configuration_fetch_words_and_a_whole_version_only() {
        let fetch = span(
            "agent.config.fetch",
            vec![
                KeyValue::new("config.outcome", "applied"),
                KeyValue::new("config.version", 5_i64),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(fetch).expect("an agent span is kept");
        assert_eq!(keys(&clean), ["config.outcome", "config.version"]);
        for outcome in ["applied", "unchanged", "invalid", "stale", "unreachable"] {
            let one = span(
                "agent.config.fetch",
                vec![KeyValue::new("config.outcome", outcome)],
                Status::Unset,
            );
            assert_eq!(keys(&sanitize_span(one).expect("kept")), ["config.outcome"]);
        }
        for version in [0_i64, 1, 2_147_483_647] {
            let one = span(
                "agent.config.fetch",
                vec![KeyValue::new("config.version", version)],
                Status::Unset,
            );
            assert_eq!(
                keys(&sanitize_span(one).expect("kept")),
                ["config.version"],
                "{version}"
            );
        }
        let other = span(
            "agent.config.fetch",
            vec![
                KeyValue::new("config.outcome", "{\"version\":5}"),
                KeyValue::new("config.outcome", 3_i64),
                KeyValue::new("config.version", "5"),
                KeyValue::new("config.version", -1_i64),
                KeyValue::new("config.version", 2_147_483_648_i64),
                KeyValue::new("config.version", 1.5_f64),
                KeyValue::new("config.body", "{}"),
                KeyValue::new("config.phrase", "Party"),
                KeyValue::new("config.probeEvery", 30_i64),
            ],
            Status::Unset,
        );
        let clean = sanitize_span(other).expect("an agent span is kept");
        assert!(keys(&clean).is_empty(), "{:?}", keys(&clean));
    }

    #[test]
    fn keeps_the_post_outcome_words_only_in_both_tiers() {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            for outcome in ["posted", "failed"] {
                let kept = in_tier(tier, vec![KeyValue::new("post.outcome", outcome)]);
                assert_eq!(kept, ["post.outcome"], "{tier:?} {outcome}");
            }
            let dropped = in_tier(
                tier,
                vec![
                    KeyValue::new("post.outcome", "timeout: connection refused"),
                    KeyValue::new("post.outcome", "Posted"),
                    KeyValue::new("post.outcome", ""),
                    KeyValue::new("post.outcome", 1_i64),
                    KeyValue::new("post.outcome", true),
                ],
            );
            assert!(dropped.is_empty(), "{tier:?} {dropped:?}");
        }
    }

    #[test]
    fn drops_window_title_process_path_screen_text_urls_events_with_paths_and_status_text() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(2);
        let mut fixture = span(
            "agent.observation.post",
            vec![
                KeyValue::new("d2r.window.title", "Diablo II Resurrected - Alice"),
                KeyValue::new("process.executable.path", "C:\\Games\\D2R\\D2R.exe"),
                KeyValue::new("d2r.screen.text", "Game Name 1234"),
                KeyValue::new("http.url", "https://api.example.test/v1/x?token=secret"),
                KeyValue::new("url.full", "https://api.example.test/v1/x"),
                KeyValue::new("d2r.room.id", "room-42"),
                KeyValue::new("d2r.agent.version", "1.2.3"),
                KeyValue::new("http.request.method", "POST"),
                KeyValue::new("http.response.status_code", 202_i64),
                KeyValue::new("status", "posted"),
            ],
            Status::Error {
                description: Cow::Borrowed(
                    "failed at C:\\Users\\alice\\AppData with https://host/path",
                ),
            },
        );
        fixture.events.events.push(Event::new(
            "exception",
            now,
            vec![KeyValue::new(
                "exception.message",
                "open C:\\Users\\alice\\file.txt",
            )],
            0,
        ));
        fixture.links.links.push(Link::new(
            SpanContext::empty_context(),
            vec![KeyValue::new("d2r.window.title", "x")],
            0,
        ));

        let clean = sanitize_span(fixture).expect("an agent span is kept");

        assert_eq!(
            keys(&clean),
            vec![
                "d2r.room.id",
                "d2r.agent.version",
                "http.request.method",
                "http.response.status_code",
                "status"
            ],
            "only the exact allowed keys survive"
        );
        assert!(clean.events.events.is_empty(), "every event is dropped");
        assert!(clean.links.links.is_empty(), "every link is dropped");
        assert_eq!(
            clean.status,
            Status::Error {
                description: Cow::Borrowed("")
            },
            "the status description is dropped"
        );
    }

    #[test]
    fn span_names_must_start_with_agent_and_strings_are_cut_at_128_characters() {
        assert!(
            sanitize_span(span("http.server.request", vec![], Status::Unset)).is_none(),
            "a non-agent span is dropped"
        );

        let long = "x".repeat(200);
        let kept = sanitize_span(span(
            "agent.heartbeat",
            vec![KeyValue::new("d2r.room.id", long)],
            Status::Unset,
        ))
        .expect("an agent span is kept");
        match &kept.attributes[0].value {
            Value::String(text) => assert_eq!(text.as_str().chars().count(), MAX_STRING_CHARS),
            other => panic!("a string value stays a string: {other:?}"),
        }
    }

    #[test]
    fn a_sanitized_span_reports_no_dropped_attributes() {
        let mut fixture = span(
            "agent.heartbeat",
            vec![KeyValue::new("d2r.window.title", "secret window")],
            Status::Unset,
        );
        fixture.dropped_attributes_count = 3;

        let clean = sanitize_span(fixture).expect("an agent span is kept");

        assert_eq!(
            clean.dropped_attributes_count, 0,
            "the sanitized span reports no dropped attributes"
        );
    }

    #[test]
    fn only_the_allowed_resource_keys_pass() {
        for key in ALLOWED_RESOURCE_KEYS {
            assert!(
                sanitize_resource_key(key),
                "{key} is an allowed resource key"
            );
        }
        assert!(
            !sanitize_resource_key("host.name"),
            "host.name is not an allowed resource key"
        );
    }

    #[tokio::test]
    async fn the_exporter_sends_only_the_sanitized_spans() {
        let recorded = Recording::default();
        let exporter = SanitizingExporter::new(recorded.clone(), TelemetryTier::Production);
        let batch = vec![
            span(
                "agent.heartbeat",
                vec![KeyValue::new("d2r.window.title", "secret window")],
                Status::Unset,
            ),
            span("http.server.request", vec![], Status::Unset),
        ];

        exporter
            .export(batch)
            .await
            .expect("the recording exporter takes the batch");

        let sent = std::mem::take(&mut *recorded.0.lock().expect("the recording"));
        assert_eq!(sent.len(), 1, "the non-agent span is not sent");
        assert!(keys(&sent[0]).is_empty(), "the window title is not sent");
    }

    fn in_tier(tier: TelemetryTier, attributes: Vec<KeyValue>) -> Vec<String> {
        let fixture = span("agent.vision.read", attributes, Status::Unset);
        keys(&super::sanitize_span(fixture, tier).expect("an agent span is kept"))
    }

    #[test]
    fn every_full_tier_key_is_dropped_in_production_and_kept_in_full() {
        for key in FULL_TIER_KEYS {
            let attributes = || vec![KeyValue::new(key, "Alice#1234")];
            assert!(
                in_tier(TelemetryTier::Production, attributes()).is_empty(),
                "{key} must not leave in production"
            );
            assert_eq!(
                in_tier(TelemetryTier::Full, attributes()),
                [key],
                "{key} passes in the full tier"
            );
        }
        // A list of names, as the party panel gives them.
        let names = Value::Array(Array::String(vec!["Alice".into(), "Bob".into()]));
        let attributes = || vec![KeyValue::new("d2r.ocr.names", names.clone())];
        assert!(in_tier(TelemetryTier::Production, attributes()).is_empty());
        assert_eq!(
            in_tier(TelemetryTier::Full, attributes()),
            ["d2r.ocr.names"]
        );
    }

    #[test]
    fn the_full_tier_keys_are_on_no_production_list() {
        for key in FULL_TIER_KEYS {
            assert!(!ALLOWED_ATTRIBUTE_KEYS.contains(&key), "{key}");
        }
    }

    #[test]
    fn the_ids_and_game_data_pass_in_both_tiers() {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            let kept = in_tier(
                tier,
                vec![
                    KeyValue::new("d2r.agent.id", "agent-1"),
                    KeyValue::new("d2r.room.id", "room-1"),
                    KeyValue::new("d2r.run.id", "room-1/2"),
                    KeyValue::new("d2r.game.name", "mmpvphell-12"),
                    KeyValue::new("d2r.difficulty", "hell"),
                    KeyValue::new("d2r.ocr.confidence", 0.87_f64),
                    KeyValue::new("d2r.ocr.corrections", "rn>m,k>h"),
                    KeyValue::new("d2r.step.duration_ms", 42_i64),
                    KeyValue::new("vision.screen", "automap"),
                    KeyValue::new("capture.method", "print-window"),
                ],
            );
            assert_eq!(
                kept,
                [
                    "d2r.agent.id",
                    "d2r.room.id",
                    "d2r.run.id",
                    "d2r.game.name",
                    "d2r.difficulty",
                    "d2r.ocr.confidence",
                    "d2r.ocr.corrections",
                    "d2r.step.duration_ms",
                    "vision.screen",
                    "capture.method"
                ],
                "{tier:?}"
            );
        }
    }

    #[test]
    fn a_name_or_text_under_a_production_key_is_dropped_in_both_tiers() {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            let dropped = in_tier(
                tier,
                vec![
                    KeyValue::new("d2r.game.name", "Alice the Sorceress"),
                    KeyValue::new("d2r.game.name", "Mm-Alice"),
                    KeyValue::new("d2r.game.name", "mm".to_string() + &"x".repeat(31)),
                    KeyValue::new("d2r.ocr.corrections", "Alice"),
                    KeyValue::new("d2r.ocr.corrections", "rn>m,Alice"),
                    KeyValue::new("d2r.ocr.corrections", "rn>m,"),
                    KeyValue::new("d2r.ocr.corrections", "abcdefg>h"),
                    KeyValue::new("d2r.ocr.corrections", "a>b>c"),
                    KeyValue::new("d2r.ocr.corrections", ""),
                    KeyValue::new("d2r.ocr.confidence", "high"),
                    KeyValue::new("d2r.ocr.confidence", 1.5_f64),
                    KeyValue::new("d2r.ocr.confidence", -0.1_f64),
                    KeyValue::new("d2r.step.duration_ms", "42"),
                    KeyValue::new("d2r.step.duration_ms", -1_i64),
                    KeyValue::new("d2r.step.duration_ms", 3_600_001_i64),
                ],
            );
            assert!(dropped.is_empty(), "{tier:?}: {dropped:?}");
        }
    }

    #[test]
    fn a_game_name_or_corrections_key_with_a_value_of_another_type_is_dropped_in_both_tiers() {
        // Without the type arm of each key the value would fall through to the "no fixed shape" rule and be kept, so a read
        // name could leave as a number, a flag, a decimal or a list under a key that must hold a short text (OBT-05).
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            for key in ["d2r.game.name", "d2r.ocr.corrections"] {
                let dropped = in_tier(
                    tier,
                    vec![
                        KeyValue::new(key, 7_i64),
                        KeyValue::new(key, 0.5_f64),
                        KeyValue::new(key, true),
                        KeyValue::new(
                            key,
                            Value::Array(Array::String(vec!["mmpvphell-12".to_string().into()])),
                        ),
                    ],
                );
                assert!(dropped.is_empty(), "{tier:?} {key}: {dropped:?}");
            }
        }
    }

    #[test]
    fn the_bounds_of_the_fixed_shapes_are_kept() {
        let kept = in_tier(
            TelemetryTier::Production,
            vec![
                KeyValue::new("d2r.ocr.confidence", 0.0_f64),
                KeyValue::new("d2r.ocr.confidence", 1.0_f64),
                KeyValue::new("d2r.step.duration_ms", 0_i64),
                KeyValue::new("d2r.step.duration_ms", 3_600_000_i64),
                KeyValue::new("d2r.ocr.corrections", "abcdef>h"),
                KeyValue::new("d2r.ocr.corrections", "a>"),
                KeyValue::new("d2r.game.name", "mm".to_string() + &"x".repeat(30)),
            ],
        );
        assert_eq!(kept.len(), 7, "{kept:?}");
    }

    #[test]
    fn credentials_and_identifying_data_leave_in_no_tier() {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            let kept = in_tier(
                tier,
                vec![
                    KeyValue::new("authorization", "Bearer abc"),
                    KeyValue::new("http.request.header.authorization", "Bearer abc"),
                    KeyValue::new("token", "abc"),
                    KeyValue::new("d2r.agent.token", "abc"),
                    KeyValue::new("cookie", "sid=1"),
                    KeyValue::new("d2r.pairing.code", "ABC123"),
                    KeyValue::new("client.address", "203.0.113.7"),
                    KeyValue::new("user_agent.original", "Mozilla"),
                    KeyValue::new("d2r.window.title", "Diablo II Resurrected - Alice"),
                    KeyValue::new("d2r.frame.pixels", "AAAA"),
                    KeyValue::new("http.url", "https://api.example.test/x?token=1"),
                    KeyValue::new("process.executable.path", "C:\\Games\\D2R.exe"),
                ],
            );
            assert!(kept.is_empty(), "{tier:?}: {kept:?}");
        }
    }

    #[test]
    fn events_links_and_status_text_go_in_the_full_tier_too() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(2);
        let mut fixture = span(
            "agent.vision.read",
            vec![KeyValue::new("d2r.ocr.text", "Alice")],
            Status::Error {
                description: Cow::Borrowed("failed at C:\\Users\\alice"),
            },
        );
        fixture.events.events.push(Event::new(
            "exception",
            now,
            vec![KeyValue::new("d2r.ocr.text", "Alice")],
            0,
        ));
        fixture
            .links
            .links
            .push(Link::new(SpanContext::empty_context(), vec![], 0));

        let clean = super::sanitize_span(fixture, TelemetryTier::Full).expect("kept");

        assert_eq!(keys(&clean), ["d2r.ocr.text"]);
        assert!(clean.events.events.is_empty());
        assert!(clean.links.links.is_empty());
        assert_eq!(
            clean.status,
            Status::Error {
                description: Cow::Borrowed("")
            }
        );
    }

    #[tokio::test]
    async fn the_exporter_applies_its_tier() {
        for (tier, expected) in [(TelemetryTier::Production, 0), (TelemetryTier::Full, 1)] {
            let recorded = Recording::default();
            let exporter = SanitizingExporter::new(recorded.clone(), tier);
            exporter
                .export(vec![span(
                    "agent.vision.read",
                    vec![KeyValue::new("d2r.ocr.text", "Alice")],
                    Status::Unset,
                )])
                .await
                .expect("the recording exporter takes the batch");
            let sent = std::mem::take(&mut *recorded.0.lock().expect("the recording"));
            assert_eq!(keys(&sent[0]).len(), expected, "{tier:?}");
        }
    }
}
