import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSummary, exitCodeOf } from '../../load/lib/summary.mjs';

// 175 000 bytes over 100 players and a 90 s window is exactly 70 000 bytes per player-hour (the budget line).
const WITHIN_BUDGET_BYTES = 175000;
const SUMMARY_KEYS = [
  'maxConcurrentPlayers',
  'maxConcurrentRooms',
  'bytesPerPlayerHour',
  'p95StateLatencyMs',
  'passed',
  'failure',
  'error',
  'ceilingReached',
  'profile',
  'limits',
  'versions',
  'commit',
  'startedAt',
  'endedAt',
  'withinEgressBudget',
  'telemetryBytesPerPlayerHour',
  'telemetryMonthlyBytes',
  'relayAllowanceMonthlyBytes',
  'telemetryShareOfBudget',
  'steps',
].sort();
const STEP_KEYS = [
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
  'errorsByKind',
  'errorsByPlayerRange',
  'containerOk',
  'passed',
  'failedRule',
].sort();

const passing = (players, overrides = {}) => ({
  players,
  latencyP95Ms: 300,
  latencyCount: 400,
  errors: 0,
  requests: 2000,
  iterations: 400,
  errorRatio: 0,
  bytesReceived: WITHIN_BUDGET_BYTES,
  telemetryBytes: 10000,
  windowSeconds: 90,
  peakCpuPercent: 40,
  peakMemoryBytes: 300 * 2 ** 20,
  roomsCreated: players,
  agentAssignedFrames: 400,
  matchesPosted: 400,
  iterationsStarted: 400,
  droppedIterations: 0,
  errorsByKind: {},
  errorsByPlayerRange: [0, 0, 0, 0],
  containerOk: true,
  passed: true,
  failedRule: null,
  ...overrides,
});
const failing = (players, failedRule, overrides = {}) =>
  passing(players, { passed: false, failedRule, ...overrides });

const limits = { cpus: '0.5', memory: '512m', k6Memory: '1500m' };
const versions = {
  k6: '2.3.0',
  sseExtension: '0.2.0',
  node: '26.0.0',
  postgres: '17',
  openssl: 'alpine/openssl:latest',
  apiImage: 'd2rmm-load-api',
};
const times = { startedAt: '2026-11-03T10:00:00.000Z', endedAt: '2026-11-03T10:20:00.000Z' };

const run = (steps, overrides = {}) =>
  buildSummary({ profile: 'full', steps, limits, versions, commit: 'abc1234', times, ...overrides });

test('maxConcurrentPlayers', () => {
  assert.equal(run([passing(25), passing(50), passing(100)]).maxConcurrentPlayers, 100);
  assert.equal(
    run([passing(25), failing(50, 'latency'), passing(100)]).maxConcurrentPlayers,
    25,
    'a later pass does not count past a failed step',
  );
  assert.equal(run([failing(25, 'container')]).maxConcurrentPlayers, 0, 'the first step fails');
  assert.equal(run([]).maxConcurrentPlayers, 0, 'no step ran');
});

test('failure names the step and the rule', () => {
  const missed = run([passing(25), passing(50), failing(100, 'latency')]);
  assert.deepEqual(missed.failure, { step: 100, rule: 'latency' });
  assert.equal(missed.passed, false);
  assert.equal(exitCodeOf(missed), 1, 'a failed 100-player step exits non-zero');

  const early = run([failing(25, 'container')]);
  assert.deepEqual(early.failure, { step: 25, rule: 'container' });
  assert.equal(exitCodeOf(early), 1);

  const telemetry = run([passing(25), passing(50), passing(100, { telemetryBytes: 30000 })]);
  assert.deepEqual(telemetry.failure, { step: 100, rule: 'telemetry' }, 'a telemetry failure after a pass');
  assert.equal(telemetry.passed, false);
  assert.equal(exitCodeOf(telemetry), 1, 'a telemetry failure exits non-zero');
});

test('top-level numbers', () => {
  const summary = run([
    passing(25, { roomsCreated: 10 }),
    passing(50, { roomsCreated: 20 }),
    passing(100, { roomsCreated: 40, latencyP95Ms: 180 }),
    failing(150, 'latency', { roomsCreated: 60, latencyP95Ms: 2500, bytesReceived: 999999 }),
  ]);
  assert.equal(summary.maxConcurrentPlayers, 100);
  assert.equal(summary.maxConcurrentRooms, 40, 'the rooms of the highest passing step');
  assert.equal(summary.p95StateLatencyMs, 180, 'the p95 of the 100-player step, not of the failed step');
  assert.ok(
    Math.abs(summary.bytesPerPlayerHour - 70000) < 1e-6,
    'bytes per player-hour is read at the 100-player step',
  );
});

test('summary fields', () => {
  const summary = run([passing(25), passing(50), passing(100)]);
  assert.deepEqual(Object.keys(summary).sort(), SUMMARY_KEYS, 'every field has its exact name');
  assert.equal(summary.profile, 'full');
  assert.deepEqual(summary.limits, limits);
  assert.deepEqual(summary.versions, versions);
  assert.equal(summary.commit, 'abc1234');
  assert.equal(summary.startedAt, times.startedAt);
  assert.equal(summary.endedAt, times.endedAt);
  assert.equal(summary.withinEgressBudget, true);
  assert.equal(summary.relayAllowanceMonthlyBytes, 16 * 2 ** 20 * 30);
  assert.equal(summary.steps.length, 3, 'one row per step');
  for (const row of summary.steps) {
    assert.deepEqual(
      Object.keys(row).sort(),
      STEP_KEYS,
      'a step row has the StepResult fields and nothing else',
    );
  }

  const over = run([passing(25), passing(50), passing(100, { bytesReceived: 175001 })]);
  assert.equal(over.withinEgressBudget, false, 'above 70 000 is outside the budget');
});

test('unmeasured numbers, ceiling and a later failure', () => {
  const noHundred = run([passing(25), passing(50)], { profile: 'full' });
  assert.equal(noHundred.p95StateLatencyMs, null);
  assert.equal(noHundred.bytesPerPlayerHour, null);
  assert.equal(noHundred.telemetryBytesPerPlayerHour, null);
  assert.equal(noHundred.telemetryMonthlyBytes, null);
  assert.equal(noHundred.telemetryShareOfBudget, null);
  assert.equal(noHundred.withinEgressBudget, null);
  assert.equal(noHundred.maxConcurrentPlayers, 50);
  assert.equal(noHundred.passed, false, 'a full run without the 100-player step does not pass');
  assert.equal(exitCodeOf(noHundred), 1);

  const ceiling = run([25, 50, 100, 150, 200, 300, 400].map((players) => passing(players)));
  assert.equal(ceiling.ceilingReached, true);
  assert.equal(ceiling.maxConcurrentPlayers, 400);
  assert.equal(exitCodeOf(ceiling), 0);

  const later = run([passing(25), passing(50), passing(100), failing(150, 'errors')]);
  assert.equal(later.passed, true, 'a later failure after a passing 100-player step keeps the run passed');
  assert.equal(later.maxConcurrentPlayers, 100, 'the last passing step holds');
  assert.deepEqual(later.failure, { step: 150, rule: 'errors' });
  assert.equal(exitCodeOf(later), 0, 'a later failure exits zero');
  assert.equal(later.ceilingReached, false);

  const smoke = buildSummary({
    profile: 'smoke',
    steps: [passing(5)],
    limits,
    versions,
    commit: 'abc1234',
    times,
  });
  assert.equal(smoke.passed, true, 'the smoke run passes on its one step');
  assert.equal(smoke.maxConcurrentPlayers, 5);
  assert.equal(smoke.p95StateLatencyMs, null, 'the smoke run has no 100-player step');
  assert.equal(exitCodeOf(smoke), 0);
});

test('no secret text in the summary', () => {
  const leaky = (players, overrides = {}) =>
    passing(players, {
      cookie: '__Host-d2rmm_session=sess-value-42',
      token: 'd2rmm_a_agent_secret',
      password: 'hunter2',
      ...overrides,
    });
  const summary = run([leaky(25), leaky(50), leaky(100)], {
    error: null,
    commit: 'abc1234',
  });
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /cookie|token|Bearer|password|d2rmm_a_|hunter2|sess-value-42/i);

  const failed = run([leaky(25, { passed: false, failedRule: 'errors' })], {
    error: 'k6 exited: Authorization Bearer d2rmm_a_leak',
  });
  assert.equal(failed.error, 'details withheld (secret text)', 'error text with a secret is withheld');
  assert.doesNotMatch(JSON.stringify(failed), /Bearer|d2rmm_a_|token|cookie|password/i);
  assert.equal(failed.passed, false);
  assert.equal(exitCodeOf(failed), 1);
});

test('step rows carry the accounting counts', () => {
  const summary = run([
    passing(25, { agentAssignedFrames: 90, matchesPosted: 25, iterationsStarted: 22, droppedIterations: 1 }),
  ]);
  const [row] = summary.steps;
  assert.equal(row.agentAssignedFrames, 90, 'the agent stream frames of the step');
  assert.equal(row.matchesPosted, 25, 'the matches posted (2xx) over the whole step');
  assert.equal(row.iterationsStarted, 22, 'the iterations started over the whole step');
  assert.equal(row.droppedIterations, 1, 'the arrivals k6 dropped');

  for (const field of ['agentAssignedFrames', 'matchesPosted', 'iterationsStarted', 'droppedIterations']) {
    assert.throws(
      () => run([passing(25, { [field]: 'd2rmm_a_leak' })]),
      TypeError,
      `${field} is a count: secret text is refused, never written`,
    );
    assert.throws(() => run([passing(25, { [field]: -1 })]), TypeError, `${field} is not negative`);
  }
});

test('step rows carry the error breakdown', () => {
  // C54: the kinds of a step add up to its errors, every kind is in the alphabet or folded into `other`, no secret text
  // reaches a kind, and a failing step carries its four player quarters (counts only).
  const kinds = { 'status:500:route:observation': 20, 'created-late': 3, 'lost-assignment': 2 };
  const failed = failing(25, 'errors', {
    errors: 25,
    matchesPosted: 402,
    iterationsStarted: 400,
    errorsByKind: kinds,
    errorsByPlayerRange: [6, 6, 6, 5],
  });
  const [row] = run([failed]).steps;
  assert.deepEqual(row.errorsByKind, kinds, 'the kinds of the step, as counted');
  assert.equal(
    Object.values(row.errorsByKind).reduce((sum, count) => sum + count, 0),
    row.errors,
    'the kinds add up to the step errors',
  );
  assert.deepEqual(row.errorsByPlayerRange, [6, 6, 6, 5], 'a failing step keeps its four quarters');

  const folded = run([
    failing(25, 'errors', {
      errors: 5,
      errorsByKind: {
        'status:500:route:observation': 1,
        d2rmm_a_leak: 1,
        'Bearer abc': 1,
        'token:abc123': 1,
        'Cookie:x1': 1,
      },
      errorsByPlayerRange: [1, 1, 1, 1],
    }),
  ]).steps[0];
  assert.deepEqual(
    folded.errorsByKind,
    { 'status:500:route:observation': 1, other: 4 },
    'outside the alphabet, or carrying secret text, a kind is folded into other; the count still adds up',
  );

  const named = run([
    failing(1, 'errors', { errors: 1, errorsByKind: { constructor: 1 }, errorsByPlayerRange: [1, 0, 0, 0] }),
  ]).steps[0];
  assert.deepEqual(
    named.errorsByKind,
    { constructor: 1 },
    'a kind named like an object property is a plain count',
  );

  const passed = run([passing(25, { errorsByPlayerRange: [1, 0, 0, 0] })]).steps[0];
  assert.equal(passed.errorsByPlayerRange, null, 'a passing step has no player quarters');

  assert.throws(
    () =>
      run([
        failing(25, 'errors', {
          errors: 4,
          errorsByKind: { 'created-late': 3 },
          errorsByPlayerRange: [1, 1, 1, 0],
        }),
      ]),
    TypeError,
    'kinds that do not add up to the errors are refused',
  );
  assert.throws(
    () => run([failing(25, 'errors', { errors: 4, errorsByKind: { 'created-late': -1, other: 5 } })]),
    TypeError,
    'a negative count is refused',
  );
  assert.throws(
    () => run([failing(25, 'errors', { errors: 4, errorsByKind: { 'created-late': 1.5, other: 2.5 } })]),
    TypeError,
    'a count is an integer',
  );
  for (const quarters of [[1, 1, 1], [1, -1, 2, 2], [1.5, 0, 0, 0], [4, 4, 4, 4], null]) {
    assert.throws(
      () =>
        run([
          failing(25, 'errors', {
            errors: 4,
            errorsByKind: { 'created-late': 4 },
            errorsByPlayerRange: quarters,
          }),
        ]),
      TypeError,
      `the quarters ${JSON.stringify(quarters)} are four counts that add up to at most the errors`,
    );
  }
});

test('a tool error is recorded and fails the run', () => {
  const summary = run([passing(25), passing(50), passing(100)], { error: 'docker stats stopped' });
  assert.equal(summary.error, 'docker stats stopped');
  assert.equal(summary.passed, false, 'a tool failure is not a pass');
  assert.equal(exitCodeOf(summary), 1);
});

test('malformed step input is refused', () => {
  assert.throws(() => run([{ ...passing(25), passed: 'yes' }]), TypeError);
  assert.throws(() => run([failing(25, 'nonsense')]), TypeError, 'a failed step names a known rule');
  assert.throws(() => run([{ ...passing(25), passed: true, failedRule: 'latency' }]), TypeError);
  assert.throws(() => run([{ ...passing(25), players: 0 }]), TypeError);
  assert.throws(() => run('not an array'), TypeError);
  assert.throws(() => run([], { profile: 'nightly' }), TypeError);
});
