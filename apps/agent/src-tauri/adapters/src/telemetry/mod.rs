//! Telemetry of the agent (AGS-12, ADR 013, OBS-18 to OBS-19, OBS-32, OBS-43): one `tracing` subscriber with an OpenTelemetry
//! layer that propagates W3C `traceparent`. With an `ExportConfig` the sampled spans also go to the relay, sanitized and
//! queued (`sanitize`, `queue`, `relay_client`); without one no span leaves the process (AD-098).

pub mod queue;
pub mod relay_client;
pub mod sanitize;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::{KeyValue, global};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{ParentBasedSampler, Sampler, SdkTracerProvider};
use tracing::{Level, Span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::{SubscriberInitExt, TryInitError};

use relay_client::HeaderSource;

const INSTRUMENTATION_SCOPE: &str = "d2rmm-agent";
/// The `service.name` of every agent span.
pub const SERVICE_NAME: &str = "d2rmm-agent";
/// Export errors reach the log at most once in this window (OBS-37).
pub const ERROR_LOG_WINDOW: Duration = Duration::from_secs(60);

/// Which events the subscriber keeps. `Release` keeps `info` and quiets the HTTP crates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Test,
    Debug,
    Release,
}

/// Where the agent exports its spans and how. The composition root builds it only when the build decides to export
/// (AD-098); `None` keeps every span in the process.
pub struct ExportConfig {
    /// The relay's traces URL.
    pub endpoint: String,
    /// The bearer token and the agent version, read per request.
    pub headers: Arc<dyn HeaderSource>,
    /// The sampling ratio, from zero to one.
    pub ratio: f64,
    /// The agent version: `service.version` and `d2r.agent.version`.
    pub agent_version: String,
    /// `deployment.environment`.
    pub environment: String,
}

/// Owns the tracer provider. `shutdown` flushes what is still queued; the composition root calls it on exit.
#[derive(Debug)]
pub struct TelemetryGuard {
    provider: SdkTracerProvider,
}

impl TelemetryGuard {
    /// Flushes the queued spans and stops the provider.
    pub fn shutdown(&self) -> OTelSdkResult {
        self.provider.shutdown()
    }
}

/// Installs the process-wide subscriber and the tracer provider. Fails when a subscriber is already installed; the app
/// calls it once.
pub fn init(mode: Mode, export: Option<ExportConfig>) -> Result<TelemetryGuard, TryInitError> {
    global::set_text_map_propagator(TraceContextPropagator::new());
    let mut builder = SdkTracerProvider::builder();
    if let Some(config) = &export {
        builder = builder
            .with_resource(agent_resource(&config.agent_version, &config.environment))
            .with_sampler(agent_sampler(config.ratio));
    }
    let provider = builder.build();
    let tracer = provider.tracer(INSTRUMENTATION_SCOPE);
    global::set_tracer_provider(provider.clone());

    tracing_subscriber::registry()
        .with(level_filter(mode))
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .try_init()?;
    Ok(TelemetryGuard { provider })
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

/// The resource of every agent span: the service name, the version and the environment, and the agent version under
/// its own key (OBS-32). Nothing else; no host or process attribute.
pub fn agent_resource(agent_version: &str, environment: &str) -> Resource {
    Resource::builder_empty()
        .with_attributes([
            KeyValue::new("service.name", SERVICE_NAME.to_string()),
            KeyValue::new("service.version", agent_version.to_string()),
            KeyValue::new("deployment.environment", environment.to_string()),
            KeyValue::new("d2r.agent.version", agent_version.to_string()),
        ])
        .build()
}

/// The agent's sampler (AD-100, AD-102): a local parent is followed, and a root or a remote parent is sampled by the
/// ratio rule of the SDK's `TraceIdRatioBased`, so the same trace id gets the same decision on every sender.
pub fn agent_sampler(ratio: f64) -> ParentBasedSampler {
    ParentBasedSampler::new(Sampler::TraceIdRatioBased(ratio))
        .with_remote_parent_sampled(Sampler::TraceIdRatioBased(ratio))
        .with_remote_parent_not_sampled(Sampler::TraceIdRatioBased(ratio))
}

/// Lets one error through per window, so a dead relay costs one log line a minute. Pure: the caller passes the instant.
#[derive(Debug, Clone, Copy)]
pub struct LogGate {
    window: Duration,
    last: Option<Instant>,
}

impl LogGate {
    pub fn new(window: Duration) -> Self {
        Self { window, last: None }
    }

    /// Whether an error at `now` may be logged.
    pub fn allow(&mut self, now: Instant) -> bool {
        let open = self
            .last
            .is_none_or(|last| now.duration_since(last) >= self.window);
        if open {
            self.last = Some(now);
        }
        open
    }
}

/// The W3C `traceparent` of `span`, or `None` when no OpenTelemetry layer is installed.
pub fn traceparent_for(span: &Span) -> Option<String> {
    let context = span.context();
    let mut carrier: HashMap<String, String> = HashMap::new();
    global::get_text_map_propagator(|propagator| propagator.inject_context(&context, &mut carrier));
    carrier.remove("traceparent")
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use opentelemetry::trace::{SpanKind, TraceId};
    use opentelemetry::{Key, Value};
    use opentelemetry_sdk::trace::{SamplingDecision, ShouldSample};
    use serde_json::Value as Json;

    use super::{LogGate, agent_resource, agent_sampler, sanitize};

    /// The vector every sender reads (AD-100), at the repository root.
    const SAMPLER_VECTOR: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../packages/telemetry/test-vectors/sampler.json"
    );

    #[test]
    fn agent_resource_carries_the_agent_version() {
        let resource = agent_resource("1.2.3", "development");

        assert_eq!(
            resource.get(&Key::new("d2r.agent.version")),
            Some(Value::from("1.2.3"))
        );
        assert_eq!(
            resource.get(&Key::new("service.name")),
            Some(Value::from("d2rmm-agent"))
        );
        assert_eq!(
            resource.get(&Key::new("service.version")),
            Some(Value::from("1.2.3"))
        );
        assert_eq!(
            resource.get(&Key::new("deployment.environment")),
            Some(Value::from("development"))
        );
        for (key, _) in resource.iter() {
            assert!(
                sanitize::sanitize_resource_key(key.as_str()),
                "{} is not a resource key the exporter sends",
                key.as_str()
            );
        }
    }

    #[test]
    fn sampler_decisions_match_the_shared_vector() {
        let text = std::fs::read_to_string(SAMPLER_VECTOR).expect("the shared sampler vector");
        let vector: Json = serde_json::from_str(&text).expect("the vector is JSON");
        let cases = vector["cases"].as_array().expect("the vector has cases");
        assert!(!cases.is_empty(), "the vector holds cases");

        for case in cases {
            let trace_id = TraceId::from_hex(case["traceId"].as_str().expect("a trace id"))
                .expect("a hex trace id");
            let ratio: f64 = case["ratio"]
                .as_str()
                .expect("a ratio")
                .parse()
                .expect("a number");
            let decision = agent_sampler(ratio)
                .should_sample(None, trace_id, "agent.check", &SpanKind::Internal, &[], &[])
                .decision;
            let sampled = decision == SamplingDecision::RecordAndSample;
            assert_eq!(
                sampled,
                case["expected"] == "sampled",
                "trace {} at ratio {ratio}",
                case["traceId"]
            );
        }
    }

    #[test]
    fn log_gate_allows_one_error_a_minute() {
        let start = Instant::now();
        let mut gate = LogGate::new(Duration::from_secs(60));

        assert!(gate.allow(start), "the first error is logged");
        assert!(
            !gate.allow(start + Duration::from_secs(59)),
            "an error inside the minute is not"
        );
        assert!(
            gate.allow(start + Duration::from_secs(60)),
            "the next minute logs again"
        );
        assert!(!gate.allow(start + Duration::from_secs(61)));
    }
}
