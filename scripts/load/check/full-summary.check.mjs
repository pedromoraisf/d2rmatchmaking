// The full-run check (tasks T33, C48): run after `pnpm test:load`, it reads `reports/load/summary.json` and asserts what the
// full run must prove (LB-10 to LB-15, LB-21, LB-22; the Success Criteria of spec.md). It writes nothing and starts nothing;
// the only Docker calls are read-only listings, made with an argument array. Run it with
// `node --test scripts/load/check/full-summary.check.mjs`. It is not a `*.test.mjs`, so `pnpm test:harness` never runs it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { profileFor } from '../lib/profile.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = join(ROOT, 'reports', 'load');
const FULL_SUMMARY = join(REPORTS, 'summary.json');
const LOCK = join(os.tmpdir(), 'd2rmm-load.lock');
const LABEL = 'd2rmm-load';
const REFERENCE_PLAYERS = 100;
const MIN_PLAYERS = 100;
const MAX_P95_MS = 2000;
const MAX_ERROR_RATIO = 0.01;
const MAX_TELEMETRY_SHARE = 0.1;
const TOP_LEVEL = ['maxConcurrentPlayers', 'maxConcurrentRooms', 'bytesPerPlayerHour', 'p95StateLatencyMs'];
const TELEMETRY_FIELDS = [
  'telemetryBytesPerPlayerHour',
  'telemetryMonthlyBytes',
  'relayAllowanceMonthlyBytes',
  'telemetryShareOfBudget',
];
const STEP_FIELDS = [
  'players',
  'latencyP95Ms',
  'latencyCount',
  'errors',
  'requests',
  'iterations',
  'errorRatio',
  'bytesReceived',
  'telemetryBytes',
  'windowSeconds',
  'peakCpuPercent',
  'peakMemoryBytes',
  'roomsCreated',
  'agentAssignedFrames',
  'matchesPosted',
  'iterationsStarted',
  'droppedIterations',
  'provisionMsByRoute',
  'containerOk',
  'passed',
  'failedRule',
];
const ACCOUNTING_FIELDS = [
  'errors',
  'requests',
  'iterations',
  'matchesPosted',
  'iterationsStarted',
  'droppedIterations',
];
const SECRET_TEXT = /cookie|bearer|password|passwd|d2rmm_a_|__host-|claimsecret|token/iu;

const text = readFileSync(FULL_SUMMARY, 'utf8');
const summary = JSON.parse(text);
const steps = summary.steps;
const reference = steps.find((row) => row.players === REFERENCE_PLAYERS);

/** The labelled resources of one kind, listed read-only. */
function labelledOf(kind) {
  const listings = {
    containers: ['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}'],
    networks: ['network', 'ls', '--filter', `label=${LABEL}`, '--format', '{{.Name}}'],
    volumes: ['volume', 'ls', '--filter', `label=${LABEL}`, '--format', '{{.Name}}'],
  };
  return execFileSync('docker', listings[kind], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

test('the full summary is a passed full run with no tool error', () => {
  assert.equal(summary.profile, 'full');
  assert.equal(summary.passed, true, 'the full run passed');
  assert.equal(summary.error, null, 'no tool error');
  // A failure after the 100-player pass is a valid pass (LB-10): it names a later step, never the reference or telemetry.
  if (summary.failure !== null) {
    assert.ok(
      summary.failure.step > REFERENCE_PLAYERS,
      'a named failure is a step after the 100-player step',
    );
    assert.notEqual(summary.failure.rule, 'telemetry', 'the telemetry share did not fail');
  }
});

test('the minimum holds: 100 players inside 2 s p95 with fewer than 1% errors', () => {
  assert.ok(
    summary.maxConcurrentPlayers >= MIN_PLAYERS,
    `maxConcurrentPlayers ${summary.maxConcurrentPlayers} >= 100`,
  );
  assert.ok(
    summary.p95StateLatencyMs <= MAX_P95_MS,
    `p95StateLatencyMs ${summary.p95StateLatencyMs} <= 2000`,
  );
  assert.ok(reference !== undefined, 'the 100-player step ran');
  assert.equal(reference.passed, true, 'the 100-player step passed');
  assert.ok(
    reference.errorRatio < MAX_ERROR_RATIO,
    `the 100-player error ratio ${reference.errorRatio} < 0.01`,
  );
});

test('the telemetry share and its report-only verdict are written', () => {
  assert.equal(typeof summary.telemetryShareOfBudget, 'number', 'the telemetry share is a number');
  assert.equal(
    summary.withinTelemetryBudget,
    summary.telemetryShareOfBudget <= MAX_TELEMETRY_SHARE,
    `withinTelemetryBudget is the share against ${MAX_TELEMETRY_SHARE}`,
  );
});

test('the top-level numbers are named, and the rooms and bytes are measured', () => {
  for (const name of TOP_LEVEL) {
    assert.ok(name in summary, `${name} is named`);
  }
  assert.ok(summary.maxConcurrentRooms > 0, 'maxConcurrentRooms is above 0');
  assert.equal(typeof summary.bytesPerPlayerHour, 'number', 'bytesPerPlayerHour is a number');
  assert.equal(typeof summary.withinEgressBudget, 'boolean', 'withinEgressBudget is a boolean');
  for (const name of TELEMETRY_FIELDS) {
    assert.equal(typeof summary[name], 'number', `${name} is a number`);
  }
});

test('there is one row per executed step, in the profile order, and each row has its fields', () => {
  const planned = profileFor('full').steps.map((step) => step.players);
  assert.ok(steps.length >= 3, 'the steps up to 100 players ran');
  assert.deepEqual(
    steps.map((row) => row.players),
    planned.slice(0, steps.length),
    'the rows are the first steps of the profile, in order',
  );
  steps.forEach((row, index) => {
    for (const field of STEP_FIELDS) {
      assert.ok(field in row, `step ${row.players} has ${field}`);
    }
    // Only the last executed step may have failed, and only after the 100-player step passed.
    if (index < steps.length - 1) assert.equal(row.passed, true, `step ${row.players} passed`);
  });
});

test('the accounting fields of every step are non-negative numbers', () => {
  for (const row of steps) {
    for (const field of ACCOUNTING_FIELDS) {
      assert.ok(Number.isFinite(row[field]) && row[field] >= 0, `step ${row.players} has ${field} >= 0`);
    }
  }
});

test('the errors of each step add up by kind', () => {
  // AD-124: the kinds are counts of the step's errors, lost assignments and dropped arrivals included.
  steps.forEach((row) => {
    const kinds = row.errorsByKind;
    assert.ok(
      kinds !== null && typeof kinds === 'object' && !Array.isArray(kinds),
      `step ${row.players} has a kind map`,
    );
    for (const [kind, count] of Object.entries(kinds)) {
      assert.match(kind, /^[A-Za-z0-9:-]+$/u, `step ${row.players}: the kind ${kind} is in the alphabet`);
      assert.ok(
        Number.isInteger(count) && count > 0,
        `step ${row.players}: the count of ${kind} is a positive whole number`,
      );
    }
    const total = Object.values(kinds).reduce((sum, count) => sum + count, 0);
    assert.equal(total, row.errors, `step ${row.players}: the kinds add up to its ${row.errors} errors`);
  });
});

test('no cookie, token or password text reaches the summary', () => {
  assert.doesNotMatch(text, SECRET_TEXT);
});

test('after the run nothing is left: no container, network, volume, work directory or lock', () => {
  assert.deepEqual(labelledOf('containers'), [], 'no labelled container');
  assert.deepEqual(labelledOf('networks'), [], 'no labelled network');
  assert.deepEqual(labelledOf('volumes'), [], 'no labelled volume');
  const leftovers = readdirSync(os.tmpdir()).filter((name) => name.startsWith('d2rmm-load-'));
  assert.deepEqual(leftovers, [], 'no work directory under the temporary directory');
  assert.equal(existsSync(LOCK), false, 'the run lock is released');
  assert.ok(statSync(FULL_SUMMARY).isFile(), 'the summary is a regular file');
});
