// A fixture for scripts/test/telemetry-tier-source.test.mjs: a step that sets a staging-only key outside the module that
// applies the tier. The rule must report it.
pub fn read(span: &tracing::Span, text: &str) {
    span.record("d2r.ocr.text", text);
}
