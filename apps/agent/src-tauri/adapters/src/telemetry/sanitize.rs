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
pub const VISION_VALUES: [(&str, &[&str]); 9] = [
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
    // The game facts the journey names (OBT-05): the API's closed sets, never a free text.
    ("d2r.difficulty", &["normal", "nightmare", "hell"]),
    ("d2r.queue.mode", &["pvp", "leveling"]),
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

const ROOM_ID_KEY: &str = "d2r.room.id";
const AGENT_ID_KEY: &str = "d2r.agent.id";
const RUN_ID_KEY: &str = "d2r.run.id";
const STATUS_KEY: &str = "status";
const HTTP_STATUS_KEY: &str = "http.response.status_code";
const HTTP_METHOD_KEY: &str = "http.request.method";
const AGENT_VERSION_KEY: &str = "d2r.agent.version";
/// The HTTP methods the agent's client may send (OTel `http.request.method`, the known set).
const HTTP_METHODS: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
/// The longest agent version text (`1.2.3-rc.1+build`).
const AGENT_VERSION_MAX_CHARS: usize = 32;
/// The longest run number text: a `u64` has at most 20 digits.
const RUN_NUMBER_MAX_DIGITS: usize = 20;

/// Whether `text` is a UUID in its canonical form (8-4-4-4-12 hexadecimal digits), the id the API issues (`randomUUID`).
fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// Whether `text` is a run id: `<room uuid>/<run number>` (`runIdOf` in the API, `run_id` in the core).
fn is_run_id(text: &str) -> bool {
    text.split_once('/').is_some_and(|(room, run)| {
        is_uuid(room)
            && !run.is_empty()
            && run.len() <= RUN_NUMBER_MAX_DIGITS
            && run.bytes().all(|b| b.is_ascii_digit())
    })
}

/// Whether `text` is a semantic version, with an optional pre-release and build: digits, letters, dots, hyphens, plus.
fn is_agent_version(text: &str) -> bool {
    let core_end = text.find(['-', '+']).unwrap_or(text.len());
    let parts: Vec<&str> = text[..core_end].split('.').collect();
    text.chars().count() <= AGENT_VERSION_MAX_CHARS
        && parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        && text[core_end..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

/// Whether `value` is an HTTP status code: an integer from 100 to 599.
fn is_http_status(value: &Value) -> bool {
    matches!(value, Value::I64(code) if (100..=599).contains(code))
}

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

/// Whether an attribute may leave the machine in `tier`: its key is allowed (a full-tier key only in the full tier) and
/// its value has the key's fixed shape. A key without a shape is dropped.
fn attribute_allowed(attribute: &KeyValue, tier: TelemetryTier) -> bool {
    attribute_allowed_among(attribute, tier, &ALLOWED_ATTRIBUTE_KEYS)
}

/// [`attribute_allowed`] over an explicit list of allowed keys, so a test can name a key that has no shape.
fn attribute_allowed_among(attribute: &KeyValue, tier: TelemetryTier, allowed: &[&str]) -> bool {
    let key = attribute.key.as_str();
    if FULL_TIER_KEYS.contains(&key) {
        return tier == TelemetryTier::Full;
    }
    if !allowed.contains(&key) {
        return false;
    }
    match (key, &attribute.value) {
        (CONFIDENCE_KEY, Value::F64(confidence)) => return (0.0..=1.0).contains(confidence),
        (CORRECTIONS_KEY, Value::String(text)) => return is_correction_list(text.as_str()),
        (DURATION_KEY, Value::I64(ms)) => return (0..=DURATION_MAX_MS).contains(ms),
        (GAME_NAME_KEY, Value::String(text)) => return is_generated_game_name(text.as_str()),
        (ROOM_ID_KEY | AGENT_ID_KEY, Value::String(text)) => return is_uuid(text.as_str()),
        (RUN_ID_KEY, Value::String(text)) => return is_run_id(text.as_str()),
        (STATUS_KEY | HTTP_STATUS_KEY, value) => return is_http_status(value),
        (HTTP_METHOD_KEY, Value::String(text)) => return HTTP_METHODS.contains(&text.as_str()),
        (AGENT_VERSION_KEY, Value::String(text)) => return is_agent_version(text.as_str()),
        // Any other value type, and any key without a typed arm, is decided below.
        _ => {}
    }
    if key == CONFIG_VERSION_KEY {
        return matches!(&attribute.value, Value::I64(version) if (0..=CONFIG_VERSION_MAX).contains(version));
    }
    // Deny by default: an allowed key without a shape above is dropped, so a key added to the list alone leaks nothing.
    match VISION_VALUES.iter().find(|(name, _)| *name == key) {
        None => false,
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

/// The keys whose shape is a whole number.
const INTEGER_KEYS: [&str; 4] = [
    STATUS_KEY,
    HTTP_STATUS_KEY,
    CONFIG_VERSION_KEY,
    DURATION_KEY,
];

/// The tracing bridge records an unsigned integer (`u16`, `u32`, `u64`) as its decimal text, not as an `i64`. Before the
/// sanitizer, for a key whose shape is a whole number, a text of plain digits that fits an `i64` becomes that number, so an
/// unsigned status is kept as the integer it is. The sanitizer itself stays strict: any other text, a sign, a space or a
/// number past `i64` included, stays text and is dropped.
fn unsigned_integers_as_numbers(span: SpanData) -> SpanData {
    SpanData {
        attributes: span
            .attributes
            .into_iter()
            .map(whole_number_of_an_integer_key)
            .collect(),
        ..span
    }
}

fn whole_number_of_an_integer_key(attribute: KeyValue) -> KeyValue {
    if !INTEGER_KEYS.contains(&attribute.key.as_str()) {
        return attribute;
    }
    let Value::String(text) = &attribute.value else {
        return attribute;
    };
    let digits = text.as_str();
    let plain = !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
    match digits.parse::<i64>() {
        Ok(number) if plain => KeyValue::new(attribute.key, number),
        _ => attribute,
    }
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
            .map(unsigned_integers_as_numbers)
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
                KeyValue::new("status", 200_i64),
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
                KeyValue::new("d2r.room.id", "0b9d6f4e-3c1a-4e55-9a57-6f1f2d3c4b5a"),
                KeyValue::new("d2r.agent.version", "1.2.3"),
                KeyValue::new("http.request.method", "POST"),
                KeyValue::new("http.response.status_code", 202_i64),
                KeyValue::new("status", 202_i64),
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

        // A string key whose shape allows more than the cut: a long list of correction classes.
        let long = vec!["rn>m"; 50].join(",");
        assert!(long.chars().count() > MAX_STRING_CHARS);
        let kept = sanitize_span(span(
            "agent.heartbeat",
            vec![KeyValue::new("d2r.ocr.corrections", long)],
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
                    KeyValue::new("d2r.agent.id", "3f0c8a52-91d4-4b7e-8c36-0a1b2c3d4e5f"),
                    KeyValue::new("d2r.room.id", "0b9d6f4e-3c1a-4e55-9a57-6f1f2d3c4b5a"),
                    KeyValue::new("d2r.run.id", "0b9d6f4e-3c1a-4e55-9a57-6f1f2d3c4b5a/2"),
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
    fn a_value_of_the_wrong_type_is_dropped_for_every_allowed_key_in_both_tiers() {
        // The type each allowed key holds: a decimal, a whole number or a text. A value of any other type is no value of
        // the key, whatever its content (a number that is a valid duration under a text key, a decimal in range under a
        // whole-number key, a text under the confidence).
        let right_type = |key: &str| match key {
            "d2r.ocr.confidence" => "f64",
            "status" | "http.response.status_code" | "config.version" | "d2r.step.duration_ms" => {
                "i64"
            }
            _ => "string",
        };
        let candidates: [(&str, Value); 4] = [
            ("string", text("x")),
            ("i64", Value::I64(250)),
            ("f64", Value::F64(0.5)),
            ("bool", Value::Bool(true)),
        ];
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            for key in ALLOWED_ATTRIBUTE_KEYS {
                let wrong: Vec<KeyValue> = candidates
                    .iter()
                    .filter(|(kind, _)| *kind != right_type(key))
                    .map(|(_, value)| KeyValue::new(key, value.clone()))
                    .collect();
                assert_eq!(wrong.len(), 3, "{key}");
                let kept = in_tier(tier, wrong);
                assert!(kept.is_empty(), "{tier:?} {key}: {kept:?}");
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

    const ROOM: &str = "0b9d6f4e-3c1a-4e55-9a57-6f1f2d3c4b5a";

    /// Both tiers keep `valid` and drop `invalid` (each as one attribute) under `key`.
    fn assert_shape(key: &'static str, valid: Vec<Value>, invalid: Vec<Value>) {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            for value in &valid {
                let kept = super::sanitize_span(
                    span(
                        "agent.x",
                        vec![KeyValue::new(key, value.clone())],
                        Status::Unset,
                    ),
                    tier,
                )
                .expect("an agent span is kept");
                assert_eq!(keys(&kept), [key], "{key} {value:?} {tier:?}");
            }
            for value in &invalid {
                let dropped = super::sanitize_span(
                    span(
                        "agent.x",
                        vec![KeyValue::new(key, value.clone())],
                        Status::Unset,
                    ),
                    tier,
                )
                .expect("an agent span is kept");
                assert!(keys(&dropped).is_empty(), "{key} {value:?} {tier:?}");
            }
        }
    }

    fn text(value: &str) -> Value {
        Value::String(value.to_string().into())
    }

    fn free_text() -> Value {
        text(&"Alice the Sorceress at C:\\Users\\alice ".repeat(3))
    }

    #[test]
    fn an_id_key_keeps_a_uuid_and_drops_anything_else() {
        for key in ["d2r.room.id", "d2r.agent.id"] {
            assert_shape(
                key,
                vec![text(ROOM), text(&ROOM.to_uppercase())],
                vec![
                    text("room-1"),
                    text(""),
                    text(&format!("{ROOM}x")),
                    text(&ROOM.replace('-', "")),
                    text(&ROOM.replace('a', "g")),
                    free_text(),
                    Value::I64(7),
                ],
            );
        }
    }

    #[test]
    fn a_run_id_is_a_room_uuid_and_a_run_number() {
        assert_shape(
            "d2r.run.id",
            vec![
                text(&format!("{ROOM}/1")),
                text(&format!("{ROOM}/18446744073709551615")),
            ],
            vec![
                text(ROOM),
                text(&format!("{ROOM}/")),
                text(&format!("{ROOM}/x")),
                text(&format!("{ROOM}/1/2")),
                text(&format!("{ROOM}/{}", "9".repeat(21))),
                text("room-1/2"),
                free_text(),
                Value::I64(1),
            ],
        );
    }

    #[test]
    fn a_status_is_an_http_status_code_in_both_keys() {
        for key in ["status", "http.response.status_code"] {
            assert_shape(
                key,
                vec![Value::I64(100), Value::I64(200), Value::I64(599)],
                vec![
                    Value::I64(99),
                    Value::I64(600),
                    Value::I64(-1),
                    Value::F64(200.0),
                    text("200"),
                    text("pending"),
                    free_text(),
                ],
            );
        }
    }

    #[test]
    fn an_http_method_is_one_of_the_known_verbs() {
        assert_shape(
            "http.request.method",
            ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
                .map(text)
                .to_vec(),
            vec![
                text("get"),
                text("GET /x?token=1"),
                text(""),
                text("_OTHER"),
                free_text(),
                Value::I64(1),
            ],
        );
    }

    #[test]
    fn an_agent_version_is_a_semantic_version() {
        assert_shape(
            "d2r.agent.version",
            vec![
                text("0.0.0"),
                text("1.12.3"),
                text("1.2.3-rc.1"),
                text("1.2.3+build.5"),
            ],
            vec![
                text(""),
                text("1.2"),
                text("1.2.x"),
                text("v1.2.3"),
                text("1.2.3 beta"),
                text(&format!("1.2.3-{}", "a".repeat(40))),
                free_text(),
                Value::I64(1),
            ],
        );
    }

    #[test]
    fn the_game_facts_are_the_closed_sets_of_the_api() {
        assert_shape(
            "d2r.difficulty",
            ["normal", "nightmare", "hell"].map(text).to_vec(),
            vec![text("Hell"), text("easy"), free_text(), Value::I64(3)],
        );
        assert_shape(
            "d2r.queue.mode",
            ["pvp", "leveling"].map(text).to_vec(),
            vec![text("PvP"), text("ranked"), free_text(), Value::I64(1)],
        );
    }

    #[test]
    fn an_allowed_key_without_a_shape_is_dropped_and_every_allowed_key_has_one() {
        // One valid sample per allowed key: a key added to the list without a shape (and a sample here) fails this test.
        let samples: Vec<(&str, Value)> = vec![
            ("vision.screen", text("in_game")),
            ("vision.search", text("track")),
            ("vision.area_class", text("box")),
            ("capture.method", text("print-window")),
            ("capture.outcome", text("frame")),
            ("config.outcome", text("applied")),
            ("config.version", Value::I64(3)),
            ("post.outcome", text("posted")),
            ("status", Value::I64(200)),
            ("d2r.room.id", text(ROOM)),
            ("d2r.agent.version", text("1.2.3")),
            ("d2r.difficulty", text("hell")),
            ("d2r.queue.mode", text("pvp")),
            ("http.request.method", text("GET")),
            ("http.response.status_code", Value::I64(404)),
            ("d2r.agent.id", text(ROOM)),
            ("d2r.run.id", text(&format!("{ROOM}/12"))),
            ("d2r.game.name", text("mmpvphell-1")),
            ("d2r.ocr.confidence", Value::F64(0.5)),
            ("d2r.ocr.corrections", text("rn>m")),
            ("d2r.step.duration_ms", Value::I64(40)),
        ];
        let pii = text("john.doe@example.com C:\\Users\\john");
        for key in ALLOWED_ATTRIBUTE_KEYS {
            let (_, valid) = samples
                .iter()
                .find(|(name, _)| *name == key)
                .unwrap_or_else(|| panic!("{key} has no sample: give it a shape and a sample"));
            assert_shape(key, vec![valid.clone()], vec![pii.clone()]);
        }
        assert_eq!(samples.len(), ALLOWED_ATTRIBUTE_KEYS.len());

        // A key on the allowed list that no shape knows is dropped, whatever its value.
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            for value in [
                pii.clone(),
                text("in_game"),
                Value::I64(200),
                Value::Bool(true),
            ] {
                let attribute = KeyValue::new("future.key", value.clone());
                assert!(
                    !super::attribute_allowed_among(&attribute, tier, &["future.key"]),
                    "{value:?} {tier:?}"
                );
            }
        }
    }

    #[test]
    fn an_array_value_under_a_shaped_key_is_dropped_in_both_tiers() {
        // A list of values that are each valid alone (and a list of free text) is still no value of the key's shape.
        let valid_strings = |items: &[&str]| {
            Value::Array(Array::String(
                items.iter().map(|i| i.to_string().into()).collect(),
            ))
        };
        for key in ALLOWED_ATTRIBUTE_KEYS {
            assert_shape(
                key,
                vec![],
                vec![
                    valid_strings(&["in_game", "pvp", "GET", ROOM]),
                    valid_strings(&["john.doe@example.com C:\\Users\\john"]),
                    Value::Array(Array::I64(vec![200, 404])),
                    Value::Array(Array::F64(vec![0.5])),
                    Value::Array(Array::Bool(vec![true])),
                ],
            );
        }
    }

    /// Records one `agent.x` span through the tracing bridge, as the agent's code does, and returns what the sanitizing
    /// exporter sent on: the span goes from a `tracing` macro to the OpenTelemetry layer to the sanitizer.
    fn through_the_bridge(tier: TelemetryTier, record: impl FnOnce()) -> Vec<SpanData> {
        use opentelemetry::trace::TracerProvider as _;
        use tracing_subscriber::layer::SubscriberExt as _;

        let recorded = Recording::default();
        let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
            .with_simple_exporter(SanitizingExporter::new(recorded.clone(), tier))
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("sanitize-test")));
        tracing::subscriber::with_default(subscriber, record);
        provider.shutdown().expect("the provider shuts down");
        let mut sent = recorded.0.lock().expect("the recording");
        std::mem::take(&mut *sent)
    }

    #[test]
    fn a_status_recorded_as_an_unsigned_or_signed_integer_is_kept_through_the_bridge() {
        for tier in [TelemetryTier::Production, TelemetryTier::Full] {
            let unsigned = through_the_bridge(tier, || {
                drop(tracing::info_span!("agent.x", status = 200_u64));
            });
            assert_eq!(unsigned.len(), 1, "{tier:?}");
            assert_eq!(keys(&unsigned[0]), ["status"], "u64 {tier:?}");
            let small = through_the_bridge(tier, || {
                drop(tracing::info_span!(
                    "agent.x",
                    status = 404_u16,
                    http.response.status_code = 503_u32
                ));
            });
            assert_eq!(
                keys(&small[0]),
                ["status", "http.response.status_code"],
                "u16 and u32 {tier:?}"
            );
            let signed = through_the_bridge(tier, || {
                drop(tracing::info_span!("agent.x", status = 200_i64));
            });
            assert_eq!(keys(&signed[0]), ["status"], "i64 {tier:?}");
            // An unsigned value out of the range of a status is dropped, as a signed one is.
            let out_of_range = through_the_bridge(tier, || {
                drop(tracing::info_span!(
                    "agent.x",
                    status = 99_u64,
                    config.version = u64::MAX
                ));
            });
            assert!(keys(&out_of_range[0]).is_empty(), "out of range {tier:?}");
        }
    }

    /// What the sanitizing exporter sent on for one `agent.x` span with this one attribute, in the production tier.
    async fn exported(attribute: KeyValue) -> Vec<KeyValue> {
        let recorded = Recording::default();
        let exporter = SanitizingExporter::new(recorded.clone(), TelemetryTier::Production);
        exporter
            .export(vec![span("agent.x", vec![attribute], Status::Unset)])
            .await
            .expect("the recording exporter takes the batch");
        let mut sent = std::mem::take(&mut *recorded.0.lock().expect("the recording"));
        assert_eq!(sent.len(), 1);
        sent.remove(0).attributes
    }

    #[tokio::test]
    async fn the_digit_string_conversion_keeps_only_plain_ascii_digits_that_fit() {
        for key in ["status", "http.response.status_code"] {
            // Plain ASCII digits become the number they spell, leading zeros included (range-checked afterwards).
            for (text, number) in [("200", 200_i64), ("0000200", 200)] {
                let kept = exported(KeyValue::new(key, text)).await;
                assert_eq!(kept.len(), 1, "{key} {text:?}");
                assert_eq!(kept[0].value, Value::I64(number), "{key} {text:?}");
            }
            let not_converted = ["+200", "-1", " 200", "200 ", "２００", "٢٠٠", ""]
                .map(String::from)
                .into_iter()
                .chain(["9".repeat(30)]);
            for text in not_converted {
                let kept = exported(KeyValue::new(key, text.clone())).await;
                assert!(kept.is_empty(), "{key} {text:?} must be dropped");
            }
        }
    }

    #[tokio::test]
    async fn only_integer_keys_convert_a_digit_string() {
        let room = "0b9d6f4e-3c1a-4e55-9a57-6f1f2d3c4b5a";
        for key in ["d2r.run.id", "d2r.room.id", "d2r.agent.version"] {
            for text in ["200", "0000200", "1234567"] {
                let kept = exported(KeyValue::new(key, text)).await;
                assert!(kept.is_empty(), "{key} {text:?} must be dropped");
            }
        }
        // The same keys still keep text of their own shape, as text.
        for (key, text) in [
            ("d2r.run.id", format!("{room}/2")),
            ("d2r.room.id", room.to_string()),
            ("d2r.agent.version", "1.2.3".to_string()),
        ] {
            let kept = exported(KeyValue::new(key, text.clone())).await;
            assert_eq!(kept.len(), 1, "{key}");
            assert_eq!(kept[0].value, Value::from(text), "{key}");
        }
    }
}
