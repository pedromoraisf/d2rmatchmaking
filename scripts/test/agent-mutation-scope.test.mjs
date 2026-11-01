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

// AHM-25 / design.md § Mutation scope: the scope names the migrated locations of the old rule modules and all of the domain.
const MUTATION_SCOPE = [
  'domain/src/**/*.rs',
  'core/src/pair.rs',
  'core/src/follow_stream.rs',
  'core/src/check_update.rs',
  'core/src/post_observation.rs',
  'core/src/beat.rs',
  'adapters/src/http/api_client.rs',
  'adapters/src/http/translate.rs',
  'adapters/src/http/sse.rs',
];

const scopeOf = (toml) => {
  const globs = toml.match(/examine_globs\s*=\s*\[([^\]]*)\]/);
  return globs ? [...globs[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
};

test('mutation rule modules list matches the migrated locations', () => {
  const toml = readFileSync('apps/agent/src-tauri/.cargo/mutants.toml', 'utf8');
  assert.deepEqual(
    MUTATION_SCOPE.filter((path) => !scopeOf(toml).includes(path)),
    [],
    'every migrated rule module is in the scope',
  );

  // A fixture that drops one module must fail the same check.
  const dropsBeat = toml.replace('  "core/src/beat.rs",\n', '');
  assert.deepEqual(
    MUTATION_SCOPE.filter((path) => !scopeOf(dropsBeat).includes(path)),
    ['core/src/beat.rs'],
    'a scope without beat.rs names it as missing',
  );
});
