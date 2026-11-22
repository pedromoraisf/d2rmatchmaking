//! Keeps every `tracing` callsite enabled for the whole test process. Test code only.
//!
//! The span and event tests record under a per-thread subscriber (`set_default`), but `tracing` caches each callsite's
//! interest for the whole process. Under `cargo test` (one process, many threads) a callsite first reached by another
//! test's thread can cache "never" while a recording test is installing its subscriber, and `rebuild_interest_cache`
//! cannot fix a registration that is still in flight on that thread; the span is then not recorded and the test fails at
//! random (`the_span_of_a_closed_panel_says_neither`, nightly baseline of the core mutation job). A global default that
//! enables everything makes every callsite "sometimes" no matter who registers it or when, so the per-thread
//! subscriber decides, and nextest (one process per test) and `cargo test` behave the same.

use std::sync::Once;
use std::sync::atomic::{AtomicU64, Ordering};

struct Everything(AtomicU64);

impl tracing::Subscriber for Everything {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _attrs: &tracing::span::Attributes<'_>) -> tracing::Id {
        tracing::Id::from_u64(self.0.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn record(&self, _span: &tracing::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::Id, _follows: &tracing::Id) {}

    fn event(&self, _event: &tracing::Event<'_>) {}

    fn enter(&self, _span: &tracing::Id) {}

    fn exit(&self, _span: &tracing::Id) {}
}

/// Installs the global enabling subscriber once; call it before a test's `set_default`.
pub fn always() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // Another global default is not expected; if one exists it already decides the interest, so the error is moot.
        let _ = tracing::subscriber::set_global_default(Everything(AtomicU64::new(0)));
    });
}
