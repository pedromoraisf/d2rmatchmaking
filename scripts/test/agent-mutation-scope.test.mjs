import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nightly = readFileSync('.github/workflows/nightly.yml', 'utf8');
const runLine = nightly.split('\n').find((line) => /cargo mutants\b/.test(line)) ?? '';

test('the nightly cargo-mutants run targets the agent core and its unit tests only (ADR 026)', () => {
  assert.match(runLine, /--package d2rmm-agent-core\b/);
  assert.match(runLine, /\s--\s+--lib\s*$/);
  assert.doesNotMatch(runLine, /--workspace|--all-targets|--tests\b/);
});
