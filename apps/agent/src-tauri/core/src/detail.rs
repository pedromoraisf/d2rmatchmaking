//! The fields the agent's spans carry for a journey (OBT-05, OBT-06; ADR 037). The ids and game data go on in both tiers;
//! the names read on screen go on only in the full tier, so a production process does not even build them. The sanitizer of
//! the adapters drops them again by key (defence in depth, OBT-08); this module is the one place the agent's core sets a
//! staging-only key (OBT-10).
//!
//! The tier is a process-wide switch the composition root sets once at start, from the build channel. Every function that
//! decides takes the tier as an argument, so tests never share state.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tracing::Span;

static FULL_TIER: AtomicBool = AtomicBool::new(false);

/// Sets the tier of this process: `true` for the full tier (staging and preview builds). The composition root calls it once,
/// before any span. Without a call the tier is production.
pub fn set_full_tier(full: bool) {
    FULL_TIER.store(full, Ordering::Relaxed);
}

/// Whether this process runs the full tier.
pub fn full_tier() -> bool {
    FULL_TIER.load(Ordering::Relaxed)
}

/// The `d2r.run.id` of a run: its room and its number, the same value the API puts on its spans.
pub fn run_id(room: &str, run: u64) -> String {
    format!("{room}/{run}")
}

/// The names of one read as the single attribute value: comma-separated, in the order read. `None` when nothing was read.
pub fn names_value<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let joined = names.into_iter().collect::<Vec<_>>().join(", ");
    (!joined.is_empty()).then_some(joined)
}

/// A step's duration as whole milliseconds, saturating.
pub fn millis(elapsed: Duration) -> i64 {
    i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
}

/// Records the ids and game data of an observation on `span`: the room, the run, the generated game name and the read's
/// confidence. All four are allowed in both tiers. The span declares the fields as `tracing::field::Empty`.
pub fn record_observation(span: &Span, room: &str, run: u64, game_name: &str, confidence: f64) {
    span.record("d2r.room.id", room);
    span.record("d2r.run.id", run_id(room, run));
    span.record("d2r.game.name", game_name);
    span.record("d2r.ocr.confidence", confidence);
}

/// Records a step's duration on `span` (`d2r.step.duration_ms`, both tiers).
pub fn record_duration(span: &Span, elapsed: Duration) {
    span.record("d2r.step.duration_ms", millis(elapsed));
}

/// Records the names a read gave on `span` as `d2r.ocr.names`, in the full tier only. `full` is the tier of the process
/// (`full_tier()`); in production nothing is recorded and `names` is not even joined.
pub fn record_names<'a>(span: &Span, full: bool, names: impl IntoIterator<Item = &'a str>) {
    if !full {
        return;
    }
    if let Some(value) = names_value(names) {
        span.record("d2r.ocr.names", value);
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        full_tier, millis, names_value, record_duration, record_names, record_observation, run_id,
    };
    use crate::event_probe::EventProbe;

    fn probe_span() -> (EventProbe, tracing::Span, tracing::subscriber::DefaultGuard) {
        let probe = EventProbe::default();
        let guard = probe.install();
        let span = tracing::info_span!(
            "agent.test",
            "d2r.room.id" = tracing::field::Empty,
            "d2r.run.id" = tracing::field::Empty,
            "d2r.game.name" = tracing::field::Empty,
            "d2r.ocr.confidence" = tracing::field::Empty,
            "d2r.ocr.names" = tracing::field::Empty,
            "d2r.step.duration_ms" = tracing::field::Empty,
        );
        (probe, span, guard)
    }

    fn fields(probe: &EventProbe) -> std::collections::BTreeMap<String, String> {
        probe.spans().remove(0).fields
    }

    #[test]
    fn a_process_without_a_call_runs_the_production_tier() {
        assert!(!full_tier());
    }

    #[test]
    fn the_run_id_is_the_room_and_the_number() {
        assert_eq!(run_id("room-1", 3), "room-1/3");
    }

    #[test]
    fn names_are_joined_in_the_order_read_and_nothing_gives_none() {
        assert_eq!(
            names_value(["Alice", "Bob"]),
            Some("Alice, Bob".to_string())
        );
        assert_eq!(names_value(std::iter::empty()), None);
    }

    #[test]
    fn an_observation_records_the_ids_and_game_data() {
        let (probe, span, _guard) = probe_span();
        record_observation(&span, "room-1", 2, "mmpvphell-12", 0.9);
        let fields = fields(&probe);
        assert_eq!(fields["d2r.room.id"], "\"room-1\"");
        assert_eq!(fields["d2r.run.id"], "\"room-1/2\"");
        assert_eq!(fields["d2r.game.name"], "\"mmpvphell-12\"");
        assert_eq!(fields["d2r.ocr.confidence"], "0.9");
        assert!(!fields.contains_key("d2r.ocr.names"));
    }

    #[test]
    fn names_are_recorded_in_the_full_tier_only() {
        let (probe, span, _guard) = probe_span();
        record_names(&span, false, ["Alice"]);
        assert!(
            !fields(&probe).contains_key("d2r.ocr.names"),
            "production records no name"
        );
        record_names(&span, true, ["Alice", "Bob"]);
        assert_eq!(fields(&probe)["d2r.ocr.names"], "\"Alice, Bob\"");
    }

    #[test]
    fn a_full_tier_read_without_names_records_nothing() {
        let (probe, span, _guard) = probe_span();
        record_names(&span, true, std::iter::empty());
        assert!(!fields(&probe).contains_key("d2r.ocr.names"));
    }

    #[test]
    fn a_duration_is_whole_milliseconds_and_saturates() {
        assert_eq!(millis(Duration::from_micros(1_999)), 1);
        assert_eq!(millis(Duration::MAX), i64::MAX);
        let (probe, span, _guard) = probe_span();
        record_duration(&span, Duration::from_millis(42));
        assert_eq!(fields(&probe)["d2r.step.duration_ms"], "42");
    }
}
