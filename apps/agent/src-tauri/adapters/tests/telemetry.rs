//! AGS-12: spans carry a W3C `traceparent`, and the capture layer records span names and fields.

mod support;

use d2rmm_agent_adapters::telemetry::{Mode, init, traceparent_for};
use support::capture::Capture;

fn is_hex(text: &str) -> bool {
    text.chars().all(|c| c.is_ascii_hexdigit())
}

#[test]
fn spans_produce_a_traceparent() {
    init(Mode::Test).expect("the test process installs its subscriber once");

    let span = tracing::info_span!("agent.heartbeat");
    let traceparent =
        traceparent_for(&span).expect("a span under the OpenTelemetry layer has a traceparent");

    let parts: Vec<&str> = traceparent.split('-').collect();
    assert_eq!(parts.len(), 4, "traceparent has four fields: {traceparent}");
    assert_eq!(parts[0], "00", "version 00");
    assert_eq!(parts[1].len(), 32, "32-hex trace id");
    assert!(
        is_hex(parts[1]) && parts[1] != "0".repeat(32),
        "non-zero hex trace id"
    );
    assert_eq!(parts[2].len(), 16, "16-hex parent id");
    assert!(
        is_hex(parts[2]) && parts[2] != "0".repeat(16),
        "non-zero hex parent id"
    );
    assert_eq!(parts[3].len(), 2, "two-hex flags");
    assert!(is_hex(parts[3]), "hex flags");
}

#[test]
fn capture_records_span_names_and_fields() {
    let capture = Capture::new();
    tracing::subscriber::with_default(capture.subscriber(), || {
        let span = tracing::info_span!("agent.observation.post", run = 7_u64, key = "idem-1");
        let _entered = span.enter();
        tracing::info!(room = "lobby-9", "posted");
    });

    let spans = capture.spans();
    assert_eq!(spans.len(), 1, "one span captured");
    assert_eq!(spans[0].name, "agent.observation.post");
    assert!(
        spans[0].fields.contains(&"run=7".to_string()),
        "run field: {:?}",
        spans[0].fields
    );
    assert!(
        spans[0].fields.contains(&"key=idem-1".to_string()),
        "key field: {:?}",
        spans[0].fields
    );

    let events = capture.events();
    assert!(
        events
            .iter()
            .any(|line| line.contains("posted") && line.contains("room=lobby-9")),
        "event with message and field: {events:?}"
    );
    assert!(capture.text().contains("agent.observation.post"));
}
