import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RETRIES,
  MAX_ATTEMPTS,
  emptyLedger,
  unitKey,
  canAttempt,
  recordAttempt,
  recordDispatch,
  clearIfOpen,
  reset,
  featureBlocked,
  lastGateAttempt,
  sessionExhausted,
  sessionId,
} from '../lib/budget.mjs';
import { taskIds } from '../lib/steps.mjs';

test('the budget is exactly one attempt plus two retries', () => {
  assert.equal(MAX_RETRIES, 2);
  assert.equal(MAX_ATTEMPTS, 3);
});

test('a gate unit blocks on the third failure and refuses a fourth attempt', () => {
  const l = emptyLedger();
  const k = unitKey('gate', 'agent-skeleton', 'T3');
  assert.deepEqual(recordAttempt(l, k, false).remainingRetries, 2);
  assert.equal(canAttempt(l, k).ok, true);
  assert.equal(recordAttempt(l, k, false).remainingRetries, 1);
  const third = recordAttempt(l, k, false);
  assert.equal(third.status, 'blocked');
  assert.equal(third.remainingRetries, 0);
  assert.equal(canAttempt(l, k).ok, false);
  assert.match(canAttempt(l, k).reason, /BLOCKED/);
  assert.equal(recordAttempt(l, k, true).status, 'blocked', 'a pass after blocking does not unblock');
  assert.equal(featureBlocked(l, 'agent-skeleton'), true);
  assert.equal(featureBlocked(l, 'api-web-skeleton'), false);
});

test('failures accumulate even across a pass: no fresh budget by breaking a green gate', () => {
  const l = emptyLedger();
  const k = unitKey('gate', 'f', 'T1');
  recordAttempt(l, k, false);
  recordAttempt(l, k, true);
  recordAttempt(l, k, false);
  assert.equal(recordAttempt(l, k, false).status, 'blocked');
});

test('dispatches: three allowed, the fourth is refused and blocks the unit', () => {
  const l = emptyLedger();
  const k = unitKey('dispatch', 'f', 'execute-batch-1', 'feature-worker');
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1)
    assert.equal(recordDispatch(l, k).allowed, true, `dispatch ${i}`);
  const fourth = recordDispatch(l, k);
  assert.equal(fourth.allowed, false);
  assert.equal(l.units[k].status, 'blocked');
  assert.equal(featureBlocked(l, 'f'), true);
});

test('session units: consecutive counters clear on green; blocked ones exhaust the session', () => {
  const l = emptyLedger();
  const k = unitKey('stop', 's1');
  recordAttempt(l, k, false);
  recordAttempt(l, k, false);
  clearIfOpen(l, k);
  assert.equal(l.units[k], undefined);
  recordAttempt(l, k, false);
  recordAttempt(l, k, false);
  recordAttempt(l, k, false);
  clearIfOpen(l, k);
  assert.equal(l.units[k].status, 'blocked', 'green never clears a blocked unit');
  assert.equal(sessionExhausted(l, 's1'), true);
  assert.equal(sessionExhausted(l, 's2'), false);
});

test('only a reset (maintainer) clears a blocked unit, and it is audited', () => {
  const l = emptyLedger();
  const k = unitKey('gate', 'f', 'spec');
  for (let i = 0; i < 3; i += 1) recordAttempt(l, k, false);
  assert.equal(reset(l, k, { by: 'pedro' }), true);
  assert.equal(canAttempt(l, k).ok, true);
  assert.equal(l.resets[0].by, 'pedro');
});

test('helpers: session ids per subagent, last gate attempt, task ids, key validation', () => {
  assert.equal(sessionId({ session_id: 'a', agent_id: 'w1' }), 'a#w1');
  assert.equal(sessionId({ session_id: 'a' }), 'a');
  const l = emptyLedger();
  recordAttempt(l, unitKey('gate', 'f', 'T1'), false, { at: '2026-11-01T10:00:00Z' });
  recordAttempt(l, unitKey('gate', 'f', 'T2'), true, { at: '2026-11-01T11:00:00Z' });
  assert.equal(lastGateAttempt(l, 'f').key, 'gate:f/T2');
  assert.equal(lastGateAttempt(l, 'g'), null);
  assert.deepEqual(taskIds('### T1: a\n## T12: b\n#### t3: c\nT4: not a heading'), ['T1', 'T12', 'T3']);
  assert.throws(() => unitKey('nope', 'x'));
  assert.throws(() => unitKey('gate'));
});
