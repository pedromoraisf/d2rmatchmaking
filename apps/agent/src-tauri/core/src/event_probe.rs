//! A test subscriber that keeps every event's message and fields (the span events of ARL-07). It is hand-written so core
//! takes no subscriber crate (the architecture rule keeps subscribers out of core's manifest). Test code only.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// One recorded event: its message and its fields, as text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recorded {
    pub message: String,
    pub fields: BTreeMap<String, String>,
}

/// Collects the events a subscriber saw, in order.
#[derive(Debug, Clone, Default)]
pub struct EventProbe {
    events: Arc<Mutex<Vec<Recorded>>>,
    spans: Arc<Mutex<Vec<Recorded>>>,
}

impl EventProbe {
    /// Installs the probe as this thread's subscriber until the guard drops.
    pub fn install(&self) -> tracing::subscriber::DefaultGuard {
        tracing::subscriber::set_default(Collector {
            events: Arc::clone(&self.events),
            spans: Arc::clone(&self.spans),
        })
    }

    /// The events seen so far.
    pub fn events(&self) -> Vec<Recorded> {
        self.events.lock().expect("the event lock").clone()
    }

    /// The spans seen so far: `message` is the span's name, `fields` its attributes and the values recorded on it later.
    pub fn spans(&self) -> Vec<Recorded> {
        self.spans.lock().expect("the span lock").clone()
    }

    /// The events with this message.
    pub fn named(&self, message: &str) -> Vec<Recorded> {
        self.events()
            .into_iter()
            .filter(|event| event.message == message)
            .collect()
    }
}

struct Collector {
    events: Arc<Mutex<Vec<Recorded>>>,
    spans: Arc<Mutex<Vec<Recorded>>>,
}

struct Writer<'a>(&'a mut Recorded);

impl tracing::field::Visit for Writer<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let text = format!("{value:?}");
        if field.name() == "message" {
            self.0.message = text;
        } else {
            self.0.fields.insert(field.name().to_string(), text);
        }
    }
}

impl tracing::Subscriber for Collector {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
        let mut recorded = Recorded {
            message: attrs.metadata().name().to_string(),
            fields: BTreeMap::new(),
        };
        attrs.record(&mut Writer(&mut recorded));
        let mut spans = self.spans.lock().expect("the span lock");
        spans.push(recorded);
        tracing::Id::from_u64(spans.len() as u64)
    }

    fn record(&self, span: &tracing::Id, values: &tracing::span::Record<'_>) {
        let mut spans = self.spans.lock().expect("the span lock");
        if let Some(recorded) = usize::try_from(span.into_u64())
            .ok()
            .and_then(|id| id.checked_sub(1))
            .and_then(|index| spans.get_mut(index))
        {
            values.record(&mut Writer(recorded));
        }
    }

    fn record_follows_from(&self, _span: &tracing::Id, _follows: &tracing::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        let mut recorded = Recorded {
            message: String::new(),
            fields: BTreeMap::new(),
        };
        event.record(&mut Writer(&mut recorded));
        self.events.lock().expect("the event lock").push(recorded);
    }

    fn enter(&self, _span: &tracing::Id) {}

    fn exit(&self, _span: &tracing::Id) {}
}
