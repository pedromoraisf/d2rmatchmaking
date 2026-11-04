import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSummary } from '../../load/lib/summary.mjs';
import { publishPlan } from '../../load/lib/publish.mjs';

const WITHIN_BUDGET_BYTES = 175000;
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

const step = (players, overrides = {}) => ({
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
  provisionMsByRoute: { 'test-login': 0, 'pairing-codes': 0, pair: 0, claim: 0 },
  containerOk: true,
  passed: true,
  failedRule: null,
  ...overrides,
});

const fullSummary = (overrides = {}) =>
  buildSummary({
    profile: 'full',
    steps: [
      step(25),
      step(50),
      step(100),
      step(150, { passed: false, failedRule: 'latency', latencyP95Ms: 2500 }),
    ],
    limits,
    versions,
    commit: 'abc1234',
    times,
    ...overrides,
  });

test('refuses a missing, smoke or failed summary', () => {
  for (const missing of [null, undefined]) {
    const plan = publishPlan(missing);
    assert.equal(plan.allowed, false, 'a missing summary is refused');
    assert.match(plan.reason, /missing/);
    assert.equal('text' in plan, false, 'a refused plan carries no document');
  }

  const smoke = publishPlan(
    buildSummary({ profile: 'smoke', steps: [step(5)], limits, versions, commit: 'abc1234', times }),
  );
  assert.equal(smoke.allowed, false, 'a smoke summary is refused');
  assert.match(smoke.reason, /smoke/);

  const failed = publishPlan(
    buildSummary({
      profile: 'full',
      steps: [step(25), step(50), step(100, { passed: false, failedRule: 'errors' })],
      limits,
      versions,
      commit: 'abc1234',
      times,
    }),
  );
  assert.equal(failed.allowed, false, 'a failed summary is refused');
  assert.match(failed.reason, /did not pass/);
  assert.equal('text' in failed, false);

  const errored = publishPlan(fullSummary({ error: 'k6 was killed' }));
  assert.equal(errored.allowed, false, 'a run with a tool error is refused');
});

test('publishes a passed full summary', () => {
  const plan = publishPlan(fullSummary());
  assert.equal(plan.allowed, true);
  const text = plan.text;

  assert.match(text, /^# Load baseline/);
  assert.match(text, /Most simultaneous players held \(`maxConcurrentPlayers`\) \| 100 \|/);
  assert.match(text, /p95 state latency at 100 players, ms \(`p95StateLatencyMs`\) \| 300 \|/);
  assert.match(text, /Bytes per player-hour at 100 players \(`bytesPerPlayerHour`\) \| 70000 \|/);
  assert.match(text, /Within the 70 000 bytes per player-hour budget \(`withinEgressBudget`\) \| yes \|/);
  assert.match(text, /API container CPUs \(`LOAD_CPUS`\) \| 0\.5 \|/, 'the limits are published');
  assert.match(text, /API container memory \(`LOAD_MEMORY`\) \| 512m \|/);
  assert.match(text, /k6 container memory \(`LOAD_K6_MEMORY`\) \| 1500m \|/);
  assert.match(text, /k6 \| 2\.3\.0 \|/, 'the versions are published');
  assert.match(text, /Measured on 2026-11-03 at commit `abc1234`/, 'the date and the commit are published');
  assert.match(text, /\| 150 \| 2500 \|.*failed: latency/, 'a later failed step is a row with its rule');
  assert.match(text, /\| 100 \| 300 \|/, 'a step row carries its p95');
});

test('the document is built only from whitelisted fields', () => {
  const noisy = {
    ...fullSummary(),
    runId: 'k7q2mz9a',
    hostPath: '/var/folders/x/d2rmm-load-k7q2mz9a',
    error: null,
    cookie: '__Host-d2rmm_session=leak-value',
    token: 'd2rmm_a_leak',
  };
  const { text } = publishPlan(noisy);
  assert.doesNotMatch(text, /k7q2mz9a|\/var\/folders|leak-value|d2rmm_a_|cookie|token|password|Bearer/i);
});

test('a run without the 100-player step is refused', () => {
  const smallRun = buildSummary({
    profile: 'full',
    steps: [step(25)],
    limits,
    versions,
    commit: 'abc1234',
    times,
  });
  const plan = publishPlan(smallRun);
  assert.equal(plan.allowed, false, 'a full run without the 100-player step does not pass, so it is refused');
});
