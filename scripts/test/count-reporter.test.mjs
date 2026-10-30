// Proves the count reporter (scripts/lib/count-reporter.mjs) that the C5-C8 proofs use (verification finding 6): a
// matching pattern passes with a count, a pattern that selects nothing fails, and a failing test fails the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import countReporter from '../lib/count-reporter.mjs';

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

// Drives the reporter directly with a synthetic event stream shaped like Node's runner events. Leaf tests carry
// details.type 'test' and a plain name; the reporter must count them and set process.exitCode itself.
async function* syntheticEvents(events) {
  for (const event of events) {
    yield event;
  }
}

function leafEvent(type, name) {
  return { type, data: { name, details: { type: 'test' } } };
}

async function runReporter(events) {
  const chunks = [];
  for await (const chunk of countReporter(syntheticEvents(events))) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

test('a mixed stream prints 1 passed and sets process.exitCode to 1 when a leaf test fails', async () => {
  const savedExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const output = await runReporter([
      leafEvent('test:pass', 'passing leaf'),
      leafEvent('test:fail', 'failing leaf'),
    ]);

    assert.match(output, /^1 passed$/m);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = savedExitCode;
  }
});

test('a passing stream with one passing leaf leaves process.exitCode unset', async () => {
  const savedExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const output = await runReporter([leafEvent('test:pass', 'passing leaf')]);

    assert.match(output, /^1 passed$/m);
    assert.notEqual(process.exitCode, 1);
  } finally {
    process.exitCode = savedExitCode;
  }
});
