import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromLoadSummary } from '../nightly/load.mjs';
import { fromPlaywright, statusOf } from '../nightly/acceptance.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nightly');
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

test('load: one row per step with players, errors, p95, bytes per player-hour and rooms (NGT-05)', () => {
  const r = fromLoadSummary(load('load-summary.json'), 70000, 'passed');
  assert.equal(r.verdict, 'passed');
  assert.equal(r.check, 'passed');
  assert.equal(r.maxConcurrentPlayers, 200);
  assert.deepEqual(r.failure, { step: 400, rule: 'p95' });
  assert.deepEqual(r.steps[0], {
    players: 100,
    errors: 0,
    p95Ms: 5.5,
    bytesPerPlayerHour: 210685,
    budget: 70000,
    withinBudget: false,
    rooms: 12,
    passed: true,
  });
});

test('load: the budget line itself is within it, and a step with no window has no bytes figure', () => {
  const r = fromLoadSummary(load('load-summary.json'));
  assert.equal(r.steps[1].bytesPerPlayerHour, 70000);
  assert.equal(r.steps[1].withinBudget, true);
  assert.equal(r.steps[2].bytesPerPlayerHour, null);
  assert.equal(r.steps[2].withinBudget, null);
  assert.equal(r.steps[2].p95Ms, null);
  assert.equal(r.steps[0].budget, 70000, 'the default budget is 70,000');
});

test('load: a failed or errored summary is a failed verdict; no summary is "not-run"', () => {
  const failed = { ...load('load-summary.json'), passed: false };
  assert.equal(fromLoadSummary(failed).verdict, 'failed');
  const errored = { ...load('load-summary.json'), error: 'k6 exited 1' };
  const r = fromLoadSummary(errored, 70000, 'failed');
  assert.equal(r.verdict, 'failed');
  assert.equal(r.error, 'k6 exited 1');
  assert.equal(r.check, 'failed');
  assert.equal(fromLoadSummary(null).verdict, 'not-run');
  assert.deepEqual(fromLoadSummary(undefined).steps, []);
});

test('acceptance: every scenario is listed with feature and tags, failures first (NGT-06)', () => {
  const r = fromPlaywright(load('playwright-results.json'));
  assert.deepEqual(
    { passed: r.passed, failed: r.failed, flaky: r.flaky, skipped: r.skipped },
    { passed: 2, failed: 1, flaky: 1, skipped: 1 },
  );
  assert.deepEqual(
    r.scenarios.map((s) => s.status),
    ['failed', 'flaky', 'skipped', 'passed', 'passed'],
  );
  assert.deepEqual(r.scenarios[0], {
    feature: 'Players queue for a match',
    title: 'A player leaves the queue',
    tags: ['@QUE-02', '@NFR-10'],
    status: 'failed',
  });
});

test('acceptance: tags in the title are read and removed from it; passed scenarios sort by feature and title', () => {
  const r = fromPlaywright(load('playwright-results.json'));
  const closes = r.scenarios.find((s) => s.title === 'The room closes');
  assert.deepEqual(closes.tags, ['@LBR-09']);
  assert.equal(closes.feature, 'Hosts open a room');
  const passed = r.scenarios.filter((s) => s.status === 'passed');
  assert.deepEqual(
    passed.map((s) => s.feature),
    ['Hosts open a room', 'Players queue for a match'],
  );
});

test('acceptance: status of a scenario follows its tests', () => {
  assert.equal(statusOf([{ status: 'expected' }]), 'passed');
  assert.equal(statusOf([{ status: 'expected' }, { status: 'unexpected' }]), 'failed');
  assert.equal(statusOf([{ status: 'flaky' }]), 'flaky');
  assert.equal(statusOf([{ status: 'skipped' }, { status: 'skipped' }]), 'skipped');
  assert.equal(statusOf([{ status: 'skipped' }, { status: 'expected' }]), 'passed');
  assert.equal(statusOf([]), 'passed');
});

test('acceptance: an empty or missing report has no scenarios', () => {
  assert.deepEqual(fromPlaywright({ suites: [] }).scenarios, []);
  assert.equal(fromPlaywright(null).failed, 0);
});
