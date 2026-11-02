//! Telemetry of the agent core (AGS-12, ADR 013): one `tracing` subscriber with an OpenTelemetry layer that propagates
//! W3C `traceparent` only. The provider has no exporter, so spans carry ids but leave the process unexported; OTLP
//! export arrives with `observability-e2e`.

pub mod queue;
pub mod relay_client;
pub mod sanitize;

use std::collections::HashMap;

use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing::{Level, Span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::{SubscriberInitExt, TryInitError};

const INSTRUMENTATION_SCOPE: &str = "d2rmm-agent";

/// Which events the subscriber keeps. `Release` keeps `info` and quiets the HTTP crates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Test,
    Debug,
    Release,
}

/// Installs the process-wide subscriber. Fails when one is already installed; the app calls it once.
pub fn init(mode: Mode) -> Result<(), TryInitError> {
    global::set_text_map_propagator(TraceContextPropagator::new());
    let provider = SdkTracerProvider::builder().build();
    let tracer = provider.tracer(INSTRUMENTATION_SCOPE);
    global::set_tracer_provider(provider);

    tracing_subscriber::registry()
        .with(level_filter(mode))
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .try_init()
}

fn level_filter(mode: Mode) -> Targets {
    match mode {
        Mode::Release => Targets::new()
            .with_default(Level::INFO)
            .with_target("hyper", Level::WARN)
            .with_target("reqwest", Level::WARN),
        Mode::Debug => Targets::new().with_default(Level::DEBUG),
        Mode::Test => Targets::new().with_default(Level::TRACE),
    }
}

/// The W3C `traceparent` of `span`, or `None` when no OpenTelemetry layer is installed.
pub fn traceparent_for(span: &Span) -> Option<String> {
    let context = span.context();
    let mut carrier: HashMap<String, String> = HashMap::new();
    global::get_text_map_propagator(|propagator| propagator.inject_context(&context, &mut carrier));
    carrier.remove("traceparent")
}
