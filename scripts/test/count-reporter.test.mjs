// Proves the count reporter (scripts/lib/count-reporter.mjs) that the C5-C8 proofs use (verification finding 6): a
// matching pattern passes with a count, a pattern that selects nothing fails, and a failing test fails the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const reporter = path.resolve(here, '..', 'lib', 'count-reporter.mjs');
const fixtures = path.join(here, 'fixtures', 'count-reporter');

// This test runs inside `node --test`, which marks child processes with NODE_TEST_CONTEXT; that marker makes the nested
// run report over IPC instead of through --test-reporter, so it is removed from the child environment.
function runWithCountReporter(fixtureName, namePattern) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const args = ['--test', `--test-reporter=${reporter}`];
  if (namePattern !== undefined) {
    args.push(`--test-name-pattern=${namePattern}`);
  }
  args.push(path.join(fixtures, fixtureName));
  return spawnSync(process.execPath, args, { encoding: 'utf8', env });
}

test('a matching name pattern exits 0 and prints 1 passed', () => {
  const run = runWithCountReporter('pass.fixture.mjs', 'counted proof passes');

  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^1 passed$/m);
});

test('a name pattern that matches nothing exits non-zero and prints 0 passed', () => {
  const run = runWithCountReporter('pass.fixture.mjs', 'no such proof exists');

  assert.notEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^0 passed$/m);
});

test('a failing fixture test exits non-zero and prints 1 failed', () => {
  const run = runWithCountReporter('fail.fixture.mjs');

  assert.notEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^1 failed$/m);
});

test('a failing test among passing ones exits non-zero and still prints 1 passed', () => {
  const run = runWithCountReporter('mixed.fixture.mjs');

  assert.notEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^1 passed$/m);
});
