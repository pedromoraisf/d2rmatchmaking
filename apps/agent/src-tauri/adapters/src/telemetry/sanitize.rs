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

/// The longest string value a span keeps, in characters (design § Agent exporter).
pub const MAX_STRING_CHARS: usize = 128;
/// Span names must start with this prefix; any other span is dropped.
pub const SPAN_NAME_PREFIX: &str = "agent.";
/// The only attribute keys a span keeps. The match is exact: `http.url` is not `http.request.method`.
pub const ALLOWED_ATTRIBUTE_KEYS: [&str; 7] = [
    "status",
    "d2r.room.id",
    "d2r.agent.version",
    "d2r.difficulty",
    "d2r.queue.mode",
    "http.request.method",
    "http.response.status_code",
];
/// The only resource attributes the exporter sends.
pub const ALLOWED_RESOURCE_KEYS: [&str; 4] = [
    "service.name",
    "service.version",
    "deployment.environment",
    "d2r.agent.version",
];

/// Sanitizes one span. A span whose name does not start with `agent.` is dropped (`None`).
pub fn sanitize_span(span: SpanData) -> Option<SpanData> {
    if !span.name.starts_with(SPAN_NAME_PREFIX) {
        return None;
    }
    let attributes = span
        .attributes
        .into_iter()
        .filter(|attribute| ALLOWED_ATTRIBUTE_KEYS.contains(&attribute.key.as_str()))
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

/// Keeps the four resource attributes the exporter sends and no other.
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
}

impl<E> SanitizingExporter<E> {
    pub fn new(inner: E) -> Self {
        Self { inner }
    }
}

impl<E: SpanExporter> SpanExporter for SanitizingExporter<E> {
    fn export(&self, batch: Vec<SpanData>) -> impl Future<Output = OTelSdkResult> + Send {
        let clean: Vec<SpanData> = batch.into_iter().filter_map(sanitize_span).collect();
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

    use opentelemetry::{InstrumentationScope, KeyValue, Value};
    use opentelemetry_sdk::error::OTelSdkResult;
    use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks};

    use super::{MAX_STRING_CHARS, SanitizingExporter, sanitize_span};

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

    #[tokio::test]
    async fn the_exporter_sends_only_the_sanitized_spans() {
        let recorded = Recording::default();
        let exporter = SanitizingExporter::new(recorded.clone());
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
}
