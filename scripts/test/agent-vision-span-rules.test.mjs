// The vision code's spans carry fixed words only (screen-recognition T8, SCR-09; AGS-20): never a text the engine read, a
// region, a coordinate or a pixel. The rule is read on the sources of core, on the repository as it is, and on sources it must
// reject.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreSrc = path.join(root, 'apps/agent/src-tauri/core/src');

// The only fields a vision span may declare or record.
const ALLOWED_FIELDS = new Set([
  'matched',
  'masked',
  // agent-trust AGT-07: a bool and a fixed FieldState code (notRead, empty, masked, text).
  'panel_open',
  'field',
  // game-name-reading GNR-07, GNR-10: the count of new joined and left chat lines, never a line or a name.
  'events',
  'screen',
  'cards',
  'vision.screen',
  'vision.search',
  'vision.area_class',
  // The capture cascade's span (capture-cascade CAP-08): the method and the outcome, as fixed words.
  'capture.method',
  'capture.outcome',
  // The configuration fetch's span (remote-config RCF-11): how a fetch ended, as a fixed word, and the whole version number.
  'config.outcome',
  'config.version',
]);
// The only values a `vision.*` field may be recorded with: the fixed-word variables of `vision_words`.
const WORD_VARIABLES = new Set(['screen_word', 'search_word', 'area_class']);
// The only values a `capture.*` field may be declared or recorded with: a method's fixed word, the outcome words and the
// constants that hold them. Never a size, a coordinate, a window title or a pixel (CAP-08).
const CAPTURE_WORDS = new Set([
  'method.word()',
  'NO_METHOD',
  'OUTCOME_SKIPPED',
  'outcome_text',
  'tracing::field::Empty',
]);

// The only values a `config.*` field may be declared or recorded with: the outcome's fixed word and the version number the
// agent runs. Never a body, a field name or a value of the configuration (RCF-11).
const CONFIG_WORDS = new Set(['outcome_word', 'version', 'tracing::field::Empty']);

// The fields of the telemetry tiers (observability-tiers OBT-05, OBT-06; ADR 037): ids, game data, confidence, a timing and,
// in the full tier only, the names read. Only the tier module (`detail.rs`) may declare or record them on a vision span, so
// a step cannot put a name on a span without going through the tier (OBT-10).
const TIER_MODULE = 'detail.rs';
const TIER_FIELDS = new Set([
  'd2r.room.id',
  'd2r.run.id',
  'd2r.game.name',
  'd2r.ocr.confidence',
  'd2r.ocr.names',
  'd2r.step.duration_ms',
]);

// The non-test part of a Rust source: tests build their own subscribers and spans.
const nonTest = (source) => source.split('#[cfg(test)]')[0];

/** The violations of the vision-span rule in one Rust source. */
export function visionSpanViolations(source, file = '') {
  const code = nonTest(source);
  const allowed = (name) => ALLOWED_FIELDS.has(name) || (file === TIER_MODULE && TIER_FIELDS.has(name));
  const violations = [];
  for (const span of code.matchAll(
    /info_span!\(\s*"agent\.(?:vision|config)[^"]*"((?:[^()]|\([^()]*\))*)\)/g,
  )) {
    for (const field of span[1].matchAll(/(?:^|,)\s*("[^"]+"|[A-Za-z_][\w.]*)\s*=/g)) {
      const name = field[1].replaceAll('"', '');
      if (!allowed(name)) violations.push(`the span declares the field ${name}`);
      else if (name.startsWith('config.')) {
        const declared = span[1].match(new RegExp(`"${name.replace('.', '\\.')}"\\s*=\\s*([^,]+)`));
        const value = declared?.[1].trim() ?? '';
        if (!CONFIG_WORDS.has(value)) {
          violations.push(`the field ${name} is declared with ${value}, not a fixed word`);
        }
      } else if (name.startsWith('capture.')) {
        const declared = span[1].match(new RegExp(`"${name.replace('.', '\\.')}"\\s*=\\s*([^,]+)`));
        const value = declared?.[1].trim() ?? '';
        if (!CAPTURE_WORDS.has(value)) {
          violations.push(`the field ${name} is declared with ${value}, not a fixed word`);
        }
      }
    }
  }
  if (!/info_span!\(\s*"agent\.(?:vision|config)/.test(code)) return violations;
  for (const record of code.matchAll(/\bspan\.record\(\s*"([^"]+)"\s*,\s*([^)]*(?:\([^)]*\))?[^)]*)\)/g)) {
    const [, name, value] = record;
    if (!allowed(name)) violations.push(`the span records the field ${name}`);
    if (name.startsWith('vision.') && !WORD_VARIABLES.has(value.trim())) {
      violations.push(`the field ${name} is recorded with ${value.trim()}, not a fixed word`);
    }
    if (name.startsWith('config.') && !CONFIG_WORDS.has(value.trim())) {
      violations.push(`the field ${name} is recorded with ${value.trim()}, not a fixed word`);
    }
    if (name.startsWith('capture.') && !CAPTURE_WORDS.has(value.trim())) {
      violations.push(`the field ${name} is recorded with ${value.trim()}, not a fixed word`);
    }
  }
  return violations;
}

test('the vision spans of core carry fixed words only', () => {
  for (const file of readdirSync(coreSrc).filter((name) => name.endsWith('.rs'))) {
    const violations = visionSpanViolations(readFileSync(path.join(coreSrc, file), 'utf8'), file);
    assert.deepEqual(violations, [], file);
  }
});

test('the rule sees the vision span of the screen reader', () => {
  const source = readFileSync(path.join(coreSrc, 'screen_reader.rs'), 'utf8');
  assert.match(nonTest(source), /info_span!\(\s*"agent\.vision\.read"/);
  assert.match(nonTest(source), /span\.record\("vision\.screen", screen_word\)/);
});

test('the rule rejects a read text, a region or a coordinate in a vision span', () => {
  const declared = `fn f() { let span = tracing::info_span!("agent.vision.read", text = tracing::field::Empty); }`;
  assert.deepEqual(visionSpanViolations(declared), ['the span declares the field text']);
  const region = `fn f() { let span = tracing::info_span!("agent.vision.read", "vision.region" = 1); }`;
  assert.deepEqual(visionSpanViolations(region), ['the span declares the field vision.region']);
  const recorded = `fn f() { let span = tracing::info_span!("agent.vision.read", "vision.screen" = tracing::field::Empty);
    span.record("vision.screen", read.text); }`;
  assert.deepEqual(visionSpanViolations(recorded), [
    'the field vision.screen is recorded with read.text, not a fixed word',
  ]);
  const coordinate = `fn f() { let span = tracing::info_span!("agent.vision.read"); span.record("x", 12); }`;
  assert.deepEqual(visionSpanViolations(coordinate), ['the span records the field x']);
});

test('the tier fields are accepted in the tier module only', () => {
  const names = `fn f() { let span = tracing::info_span!("agent.vision.read-characters", "d2r.ocr.names" = tracing::field::Empty);
    span.record("d2r.ocr.names", value); }`;
  assert.deepEqual(visionSpanViolations(names, TIER_MODULE), []);
  assert.deepEqual(visionSpanViolations(names, 'watch_screen.rs'), [
    'the span declares the field d2r.ocr.names',
    'the span records the field d2r.ocr.names',
  ]);
  assert.deepEqual(visionSpanViolations(names), [
    'the span declares the field d2r.ocr.names',
    'the span records the field d2r.ocr.names',
  ]);
});

test('the rule sees the capture span of the capturer and accepts its fixed words', () => {
  const source = readFileSync(path.join(coreSrc, 'capturer.rs'), 'utf8');
  assert.match(nonTest(source), /info_span!\(\s*"agent\.vision\.capture"/);
  assert.match(nonTest(source), /span\.record\("capture\.outcome", outcome_text\)/);
  assert.deepEqual(visionSpanViolations(source), []);
});

test('the rule rejects a size, a title or a coordinate in the capture span', () => {
  const size = `fn f() { let span = tracing::info_span!("agent.vision.capture", "capture.method" = size.width, "capture.outcome" = tracing::field::Empty); }`;
  assert.deepEqual(visionSpanViolations(size), [
    'the field capture.method is declared with size.width, not a fixed word',
  ]);
  const title = `fn f() { let span = tracing::info_span!("agent.vision.capture", "capture.method" = method.word(), "capture.window" = title); }`;
  assert.deepEqual(visionSpanViolations(title), ['the span declares the field capture.window']);
  const recorded = `fn f() { let span = tracing::info_span!("agent.vision.capture", "capture.outcome" = tracing::field::Empty);
    span.record("capture.outcome", frame.width); }`;
  assert.deepEqual(visionSpanViolations(recorded), [
    'the field capture.outcome is recorded with frame.width, not a fixed word',
  ]);
});

test('the rule sees the configuration fetch span of core and accepts its fixed words', () => {
  const source = readFileSync(path.join(coreSrc, 'remote_config.rs'), 'utf8');
  assert.match(nonTest(source), /info_span!\(\s*"agent\.config\.fetch"/);
  assert.match(nonTest(source), /span\.record\("config\.outcome", outcome_word\)/);
  assert.match(nonTest(source), /span\.record\("config\.version", version\)/);
  assert.deepEqual(visionSpanViolations(source), []);
});

test('the rule rejects a body, a field name or a value in the configuration fetch span', () => {
  const body = `fn f() { let span = tracing::info_span!("agent.config.fetch", "config.outcome" = tracing::field::Empty, "config.body" = text); }`;
  assert.deepEqual(visionSpanViolations(body), ['the span declares the field config.body']);
  const declared = `fn f() { let span = tracing::info_span!("agent.config.fetch", "config.outcome" = body.text); }`;
  assert.deepEqual(visionSpanViolations(declared), [
    'the field config.outcome is declared with body.text, not a fixed word',
  ]);
  const recorded = `fn f() { let span = tracing::info_span!("agent.config.fetch", "config.outcome" = tracing::field::Empty);
    span.record("config.outcome", body); }`;
  assert.deepEqual(visionSpanViolations(recorded), [
    'the field config.outcome is recorded with body, not a fixed word',
  ]);
  const other = `fn f() { let span = tracing::info_span!("agent.config.fetch"); span.record("config.phrase", version); }`;
  assert.deepEqual(visionSpanViolations(other), ['the span records the field config.phrase']);
});

test('the rule accepts the fixed words and leaves other spans alone', () => {
  const fine = `fn f() { let span = tracing::info_span!("agent.vision.read", "vision.screen" = tracing::field::Empty);
    span.record("vision.screen", screen_word); }`;
  assert.deepEqual(visionSpanViolations(fine), []);
  const other = `fn f() { let span = tracing::info_span!("agent.beat", text = 1); }`;
  assert.deepEqual(visionSpanViolations(other), []);
});
