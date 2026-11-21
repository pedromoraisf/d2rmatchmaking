// The automap and chat steps put fixed words in their spans and counters, never a game name or a chat line (game-name-reading
// GNR-10; NFR-04; AGENTS.md rule 10). The rule is read on the sources of the two steps, on the repository as it is, and on
// sources it must reject. A name read from the screen, or a player's name read from a chat line, never reaches a tracing
// macro: only the fields below, with a string literal or a fixed-word call as the value.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreSrc = path.join(root, 'apps/agent/src-tauri/core/src');
const FILES = ['automap_name.rs', 'chat_step.rs'];

// The only fields a tracing macro of these steps may carry: a bool or a count, and the fixed words of the counters.
const ALLOWED_FIELDS = new Set(['matched', 'events', 'source', 'outcome', 'kind']);
// The only expressions a field may take: a literal, a bool, a count, or the call of a fixed-word function.
const FIXED_VALUES = [
  /^"[a-z-]+"$/,
  /^(true|false)$/,
  /^tracing::field::Empty$/,
  /^read\.word\(\)$/,
  /^event\.kind\(\)$/,
];

// The non-test part of a Rust source: tests build their own subscribers and assert on the words.
const nonTest = (source) => source.split('#[cfg(test)]')[0];

/** The text of each balanced `( ... )` that follows a tracing macro name in `code`. */
function macroBodies(code) {
  const bodies = [];
  for (const start of code.matchAll(/\btracing::(?:info_span|info|warn|error|debug|trace)!\(/g)) {
    let depth = 1;
    let at = start.index + start[0].length;
    const begin = at;
    for (; at < code.length && depth > 0; at += 1) {
      if (code[at] === '(') depth += 1;
      else if (code[at] === ')') depth -= 1;
    }
    bodies.push(code.slice(begin, at - 1));
  }
  return bodies;
}

/** The violations of the fixed-words rule in one Rust source. */
export function nameReadingViolations(source) {
  const code = nonTest(source);
  const violations = [];
  for (const body of macroBodies(code)) {
    // The message is the last string literal; the fields are `name = value` pairs before it.
    const parts = body
      .split(/,(?![^()]*\))/)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    for (const part of parts) {
      const field = /^([A-Za-z_][\w.]*)\s*=\s*(.+)$/s.exec(part);
      if (field === null) {
        if (!/^"[^"{}]*"$/.test(part)) violations.push(`the macro argument ${part} is not a plain message`);
        continue;
      }
      const [, name, value] = field;
      if (!ALLOWED_FIELDS.has(name)) violations.push(`the macro carries the field ${name}`);
      if (!FIXED_VALUES.some((fixed) => fixed.test(value.trim()))) {
        violations.push(`the field ${name} takes ${value.trim()}, not a fixed word`);
      }
    }
  }
  for (const record of code.matchAll(/\bspan\.record\(\s*"([^"]+)"\s*,\s*(.+?)\)\s*;/g)) {
    const [, name, value] = record;
    if (!ALLOWED_FIELDS.has(name)) violations.push(`the span records the field ${name}`);
    if (!/^(true|false|events\.len\(\))$/.test(value.trim())) {
      violations.push(`the field ${name} is recorded with ${value.trim()}, not a fixed word`);
    }
  }
  return violations;
}

test('the automap and chat steps carry fixed words only', () => {
  for (const file of FILES) {
    const violations = nameReadingViolations(readFileSync(path.join(coreSrc, file), 'utf8'));
    assert.deepEqual(violations, [], file);
  }
});

test('the rule sees the span and the counter of each step', () => {
  const automap = nonTest(readFileSync(path.join(coreSrc, FILES[0]), 'utf8'));
  assert.match(automap, /info_span!\("agent\.vision\.read-automap-name", matched = false\)/);
  assert.match(automap, /"agent\.vision\.name_reads"/);
  const chat = nonTest(readFileSync(path.join(coreSrc, FILES[1]), 'utf8'));
  assert.match(chat, /info_span!\("agent\.vision\.read-chat", events = tracing::field::Empty\)/);
  assert.match(chat, /tracing::info!\(kind = event\.kind\(\), "agent\.vision\.chat_events"\)/);
});

test('the rule rejects a name, a text or a format string in a tracing macro', () => {
  const name = `fn f() { tracing::info!(name = read.text, "agent.vision.name_reads"); }`;
  assert.ok(nameReadingViolations(name).length > 0);
  const field = `fn f() { tracing::info!(source = "automap", player = "x", "agent.vision.name_reads"); }`;
  assert.deepEqual(nameReadingViolations(field), ['the macro carries the field player']);
  const value = `fn f() { tracing::info!(kind = name, "agent.vision.chat_events"); }`;
  assert.deepEqual(nameReadingViolations(value), ['the field kind takes name, not a fixed word']);
  const formatted = `fn f() { tracing::info!("{name} joined"); }`;
  assert.deepEqual(nameReadingViolations(formatted), [
    'the macro argument "{name} joined" is not a plain message',
  ]);
  const recorded = `fn f() { span.record("text", read.text); }`;
  assert.deepEqual(nameReadingViolations(recorded), [
    'the span records the field text',
    'the field text is recorded with read.text, not a fixed word',
  ]);
});

test('the rule accepts the fixed words and ignores test code', () => {
  const fine = `fn f() {
    let span = tracing::info_span!("agent.vision.read-chat", events = tracing::field::Empty);
    span.record("events", events.len());
    tracing::info!(kind = event.kind(), "agent.vision.chat_events");
    tracing::info!(source = "automap", outcome = read.word(), "agent.vision.name_reads");
  }`;
  assert.deepEqual(nameReadingViolations(fine), []);
  const tests = `fn f() {}\n#[cfg(test)]\nmod tests { fn t() { tracing::info!(name = read.text, "x"); } }`;
  assert.deepEqual(nameReadingViolations(tests), []);
});
