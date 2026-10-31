//! Records what a test subscriber sees: span names and fields, and event lines. A secret must not appear in `text()`
//! (AGS-09, AGS-12).

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Record};
use tracing::{Event, Id, Subscriber};
use tracing_subscriber::Registry;
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

/// A span as the capture saw it: its name and every `name=value` field, including fields recorded later.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedSpan {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Default)]
struct State {
    spans: Vec<CapturedSpan>,
    events: Vec<String>,
}

/// The shared record of one capture. Clone it to read the record from the test after the layer has written it.
#[derive(Debug, Clone, Default)]
pub struct Capture {
    state: Arc<Mutex<State>>,
}

impl Capture {
    pub fn new() -> Self {
        Self::default()
    }

    /// The layer that writes into this capture.
    pub fn layer(&self) -> CaptureLayer {
        CaptureLayer {
            state: Arc::clone(&self.state),
        }
    }

    /// A subscriber made of this capture alone. Install it with `tracing::subscriber::with_default`.
    pub fn subscriber(&self) -> impl Subscriber + Send + Sync + 'static {
        Registry::default().with(self.layer())
    }

    pub fn spans(&self) -> Vec<CapturedSpan> {
        lock(&self.state).spans.clone()
    }

    pub fn events(&self) -> Vec<String> {
        lock(&self.state).events.clone()
    }

    /// Every span name, span field and event line, joined. Assertions that a secret never leaked search this text.
    pub fn text(&self) -> String {
        let state = lock(&self.state);
        let mut parts: Vec<String> = Vec::new();
        for span in &state.spans {
            parts.push(span.name.clone());
            parts.extend(span.fields.iter().cloned());
        }
        parts.extend(state.events.iter().cloned());
        parts.join("\n")
    }
}

/// The `tracing` layer behind a `Capture`.
#[derive(Debug)]
pub struct CaptureLayer {
    state: Arc<Mutex<State>>,
}

/// Remembers which captured span an `Id` belongs to, so later `record` calls reach the right entry.
struct SpanIndex(usize);

impl<S> Layer<S> for CaptureLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut fields = FieldLines::default();
        attrs.record(&mut fields);
        let index = {
            let mut state = lock(&self.state);
            state.spans.push(CapturedSpan {
                name: attrs.metadata().name().to_string(),
                fields: fields.lines,
            });
            state.spans.len() - 1
        };
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(SpanIndex(index));
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else {
            return;
        };
        let Some(index) = span.extensions().get::<SpanIndex>().map(|found| found.0) else {
            return;
        };
        let mut fields = FieldLines::default();
        values.record(&mut fields);
        lock(&self.state).spans[index].fields.extend(fields.lines);
    }

    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut fields = FieldLines::default();
        event.record(&mut fields);
        lock(&self.state).events.push(fields.lines.join(" "));
    }
}

/// Turns each field into a `name=value` line; the message field becomes its bare text.
#[derive(Default)]
struct FieldLines {
    lines: Vec<String>,
}

impl FieldLines {
    fn push(&mut self, field: &Field, value: String) {
        if field.name() == "message" {
            self.lines.push(value);
        } else {
            self.lines.push(format!("{}={value}", field.name()));
        }
    }
}

impl Visit for FieldLines {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.push(field, value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.push(field, format!("{value:?}"));
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}
