//! The agent's span export (OBS-18, OBS-19, OBS-38, AD-096). `DropOldestProcessor` queues every ended span and never waits;
//! `export_loop` drains the queue every five seconds, at most 256 spans a batch, through the sanitizer and the relay client.
//! The SDK's batch processor drops the newest span when it is full, so the agent keeps its own queue (OBS-18).

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use opentelemetry::Context;
use opentelemetry_sdk::error::OTelSdkResult;
use opentelemetry_sdk::trace::{Span, SpanData, SpanExporter, SpanProcessor};

use super::queue::BoundedQueue;
use super::{ERROR_LOG_WINDOW, LogGate};

/// How often the export task drains the queue (design § Agent exporter).
pub const EXPORT_INTERVAL: Duration = Duration::from_secs(5);
/// The most spans one batch carries (design § Agent exporter).
pub const EXPORT_BATCH: usize = 256;

/// The queue the processor fills and the export task drains.
pub type SpanQueue = Arc<Mutex<BoundedQueue<SpanData>>>;

fn lock(queue: &SpanQueue) -> MutexGuard<'_, BoundedQueue<SpanData>> {
    queue.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A span processor that queues each ended span in a bounded queue that drops its oldest entry when full. `on_end` takes
/// the lock for one push and returns: the caller never waits for the relay.
#[derive(Debug)]
pub struct DropOldestProcessor {
    queue: SpanQueue,
}

impl DropOldestProcessor {
    pub fn new(queue: SpanQueue) -> Self {
        Self { queue }
    }
}

impl SpanProcessor for DropOldestProcessor {
    fn on_start(&self, _span: &mut Span, _context: &Context) {}

    fn on_end(&self, span: SpanData) {
        let _dropped = lock(&self.queue).push(span);
    }

    fn force_flush(&self) -> OTelSdkResult {
        Ok(())
    }

    fn shutdown_with_timeout(&self, _timeout: Duration) -> OTelSdkResult {
        Ok(())
    }
}

/// Drains the queue every `interval` and exports each batch of at most `EXPORT_BATCH` spans. A failed export drops its
/// batch and is reported through `report` at most once a minute. Nothing stops the loop: an unreachable or slow relay
/// costs the batch, never the loop (OBS-38).
pub async fn export_loop<E, R>(queue: SpanQueue, exporter: E, interval: Duration, mut report: R)
where
    E: SpanExporter,
    R: FnMut(&str) + Send,
{
    let mut ticks = tokio::time::interval(interval);
    let mut gate = LogGate::new(ERROR_LOG_WINDOW);
    loop {
        ticks.tick().await;
        let batch = lock(&queue).drain(EXPORT_BATCH);
        if batch.is_empty() {
            continue;
        }
        let now = tokio::time::Instant::now().into_std();
        if exporter.export(batch).await.is_err() && gate.allow(now) {
            report("the span export failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime};

    use opentelemetry::InstrumentationScope;
    use opentelemetry::trace::{
        SpanContext, SpanId, SpanKind, Status, TraceFlags, TraceId, TraceState,
    };
    use opentelemetry_sdk::error::{OTelSdkError, OTelSdkResult};
    use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks, SpanProcessor};

    use super::{DropOldestProcessor, EXPORT_BATCH, EXPORT_INTERVAL, SpanQueue, export_loop};
    use crate::telemetry::queue::{BoundedQueue, SPAN_QUEUE_CAPACITY};

    fn span(number: usize) -> SpanData {
        let context = SpanContext::new(
            TraceId::from_bytes(((number as u128) + 1).to_be_bytes()),
            SpanId::from_bytes(((number as u64) + 1).to_be_bytes()),
            TraceFlags::SAMPLED,
            false,
            TraceState::default(),
        );
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        SpanData {
            span_context: context,
            parent_span_id: SpanId::INVALID,
            parent_span_is_remote: false,
            span_kind: SpanKind::Internal,
            name: Cow::Borrowed("agent.heartbeat"),
            start_time: now,
            end_time: now,
            attributes: Vec::new(),
            dropped_attributes_count: 0,
            events: SpanEvents::default(),
            links: SpanLinks::default(),
            status: Status::Unset,
            instrumentation_scope: InstrumentationScope::builder("d2rmm-agent").build(),
        }
    }

    fn queue() -> SpanQueue {
        Arc::new(Mutex::new(BoundedQueue::new(SPAN_QUEUE_CAPACITY)))
    }

    /// Records the size of every batch it is given and takes the batch.
    #[derive(Debug, Clone, Default)]
    struct Recording(Arc<Mutex<Vec<usize>>>);

    impl SpanExporter for Recording {
        fn export(
            &self,
            batch: Vec<SpanData>,
        ) -> impl std::future::Future<Output = OTelSdkResult> + Send {
            self.0.lock().expect("the sizes").push(batch.len());
            async { Ok(()) }
        }
    }

    /// Counts its calls and refuses every batch, as an unreachable relay does.
    #[derive(Debug, Clone, Default)]
    struct Unreachable(Arc<AtomicUsize>);

    impl SpanExporter for Unreachable {
        fn export(
            &self,
            _batch: Vec<SpanData>,
        ) -> impl std::future::Future<Output = OTelSdkResult> + Send {
            self.0.fetch_add(1, Ordering::SeqCst);
            async { Err(OTelSdkError::InternalFailure("unreachable".to_string())) }
        }
    }

    /// Counts its calls and never answers, as a relay that holds the connection does.
    #[derive(Debug, Clone, Default)]
    struct Slow(Arc<AtomicUsize>);

    impl SpanExporter for Slow {
        fn export(
            &self,
            _batch: Vec<SpanData>,
        ) -> impl std::future::Future<Output = OTelSdkResult> + Send {
            self.0.fetch_add(1, Ordering::SeqCst);
            async {
                std::future::pending::<()>().await;
                Ok(())
            }
        }
    }

    #[test]
    fn on_end_queues_the_span_without_exporting_it() {
        let queue = queue();
        let processor = DropOldestProcessor::new(Arc::clone(&queue));

        processor.on_end(span(0));

        assert_eq!(queue.lock().expect("the queue").len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_relay_never_delays_a_caller() {
        let queue = queue();
        let calls = Arc::new(AtomicUsize::new(0));
        let processor = DropOldestProcessor::new(Arc::clone(&queue));
        processor.on_end(span(0));
        tokio::spawn(export_loop(
            Arc::clone(&queue),
            Slow(Arc::clone(&calls)),
            EXPORT_INTERVAL,
            |_| {},
        ));
        tokio::time::sleep(EXPORT_INTERVAL + Duration::from_millis(1)).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the first batch is stuck on the relay"
        );

        for number in 1..=300 {
            processor.on_end(span(number));
        }

        assert_eq!(
            queue.lock().expect("the queue").len(),
            300,
            "every span ended while the relay holds the export is queued"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn the_loops_keep_running_when_the_relay_is_unreachable() {
        let queue = queue();
        let calls = Arc::new(AtomicUsize::new(0));
        let reports = Arc::new(Mutex::new(Vec::<String>::new()));
        let processor = DropOldestProcessor::new(Arc::clone(&queue));
        let sink = Arc::clone(&reports);
        tokio::spawn(export_loop(
            Arc::clone(&queue),
            Unreachable(Arc::clone(&calls)),
            EXPORT_INTERVAL,
            move |message| sink.lock().expect("the reports").push(message.to_string()),
        ));

        for round in 0..30 {
            processor.on_end(span(round));
            tokio::time::sleep(EXPORT_INTERVAL).await;
        }

        assert!(
            calls.load(Ordering::SeqCst) >= 25,
            "the export loop kept trying every interval"
        );
        let logged = reports.lock().expect("the reports").len();
        assert!(
            (2..=3).contains(&logged),
            "at most one error line a minute over 150 seconds, got {logged}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn export_takes_at_most_256_spans_every_five_seconds() {
        let queue = queue();
        let sizes = Recording::default();
        {
            let mut queued = queue.lock().expect("the queue");
            for number in 0..(EXPORT_BATCH + 44) {
                queued.push(span(number));
            }
        }
        tokio::spawn(export_loop(
            Arc::clone(&queue),
            sizes.clone(),
            EXPORT_INTERVAL,
            |_| {},
        ));

        tokio::time::sleep(EXPORT_INTERVAL + Duration::from_secs(1)).await;

        assert_eq!(
            *sizes.0.lock().expect("the sizes"),
            vec![256, 44],
            "a full batch, then the rest five seconds later"
        );
    }
}
