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
}

impl EventProbe {
    /// Installs the probe as this thread's subscriber until the guard drops.
    pub fn install(&self) -> tracing::subscriber::DefaultGuard {
        tracing::subscriber::set_default(Collector {
            events: Arc::clone(&self.events),
        })
    }

    /// The events seen so far.
    pub fn events(&self) -> Vec<Recorded> {
        self.events.lock().expect("the event lock").clone()
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

    fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
        tracing::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::Id, _values: &tracing::span::Record<'_>) {}

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
