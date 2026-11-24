// A fixture for scripts/test/telemetry-tier-source.test.mjs: a step that records ids and goes through the tier helper for
// names. The rule must accept it. The key appears only in a test, which the rule skips.
pub fn read(span: &tracing::Span, room: &str, names: &[&str]) {
    span.record("d2r.room.id", room);
    detail::record_names(span, detail::full_tier(), names.iter().copied());
}

#[cfg(test)]
mod tests {
    const KEY: &str = "d2r.ocr.names";
}
