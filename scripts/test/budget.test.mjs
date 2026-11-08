import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RETRIES,
  MAX_ATTEMPTS,
  emptyLedger,
  unitKey,
  canAttempt,
  failuresOf,
  recordAttempt,
  recordDispatch,
  clearIfOpen,
  reset,
  mergeLedgers,
  featureBlocked,
  lastGateAttempt,
  sessionExhausted,
  sessionId,
  ENV_ATTEMPTS_TO_BLOCK,
  envFailuresOf,
  orchestratorResets,
  recordRefusal,
  report,
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

test('reads attempts recorded without the new fields', () => {
  // A ledger written before HBS-25: attempts hold only at/ok/note. They still count toward the budget.
  const old = {
    version: 1,
    units: {
      'gate:f/T1': {
        status: 'open',
        attempts: [
          { at: '2026-11-01T10:00:00Z', ok: false, note: 'first' },
          { at: '2026-11-01T10:05:00Z', ok: false, note: 'second' },
        ],
      },
    },
  };
  const k = 'gate:f/T1';
  assert.equal(failuresOf(old, k), 2);
  assert.equal(canAttempt(old, k).ok, true);
  assert.equal(canAttempt(old, k).attempt, 3);
  assert.equal(
    recordAttempt(old, k, false, { command: 'pnpm test', head: 'abc', clean: true }).status,
    'blocked',
  );
  assert.equal(old.units[k].attempts.at(-1).command, 'pnpm test');
  assert.equal(old.units[k].attempts[0].command, undefined, 'old attempts are left as they were');
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

test('merging a ledger with itself or a shared snapshot keeps each reset once and changes no unit', () => {
  const live = emptyLedger();
  const blocked = unitKey('gate', 'f', 'spec');
  const open = unitKey('gate', 'f', 'design');
  for (let i = 0; i < 3; i += 1) recordAttempt(live, blocked, false);
  assert.equal(reset(live, blocked, { by: 'pedro' }), true);
  recordAttempt(live, open, false);
  const snapshot = structuredClone(live);

  const once = mergeLedgers(live, snapshot);
  let merged = live;
  for (let i = 0; i < 5; i += 1) merged = mergeLedgers(merged, snapshot);
  for (let i = 0; i < 5; i += 1) merged = mergeLedgers(merged, merged);

  const unique = new Set(live.resets.map((r) => `${r.key}|${r.at}|${r.by}`)).size;
  assert.equal(unique, 1);
  assert.equal(once.resets.length, 1, 'one merge keeps one copy of the reset');
  assert.equal(merged.resets.length, unique, 'repeated merges do not append the resets again');
  assert.deepEqual(merged.resets, once.resets);
  assert.deepEqual(merged.units, once.units, 'units are the same after repeated merges');
  assert.equal(once.units[open].attempts.length, 1);
  assert.equal(once.units[open].attempts.filter((a) => !a.ok).length, 1, 'open failures are not lost');
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

const ENV = { kind: 'env', signature: 'docker' };
const T2 = 'gate:budget-v2/T2';

test('records an environment failure without counting it', () => {
  const l = emptyLedger();
  const res = recordAttempt(l, T2, false, { ...ENV, note: 'Cannot connect to the Docker daemon' });
  assert.equal(res.status, 'open');
  assert.equal(res.failures, 0);
  assert.equal(res.remainingRetries, 2);
  assert.equal(failuresOf(l, T2), 0);
  assert.equal(envFailuresOf(l, T2), 1);
  assert.equal(canAttempt(l, T2).attempt, 1, 'the next attempt is still the first');
  const a = l.units[T2].attempts[0];
  assert.equal(a.ok, false);
  assert.equal(a.kind, 'env');
  assert.equal(a.signature, 'docker');
  assert.throws(
    () => recordAttempt(l, T2, false, { kind: 'env' }),
    'an environment failure names its signature',
  );
});

test('three environment failures in a row block the unit', () => {
  const l = emptyLedger();
  recordAttempt(l, T2, false, ENV);
  assert.equal(recordAttempt(l, T2, false, ENV).status, 'open');
  assert.equal(recordAttempt(l, T2, false, ENV).status, 'env-blocked');
  assert.equal(canAttempt(l, T2).ok, false);
  assert.match(canAttempt(l, T2).reason, /ENV-BLOCKED/);
  assert.equal(recordAttempt(l, T2, true).status, 'env-blocked', 'a pass after the block does not unblock');
  assert.equal(failuresOf(l, T2), 0, 'the block spent no counted failure');
  assert.equal(ENV_ATTEMPTS_TO_BLOCK, 3);
});

test('a counted failure restarts the environment count', () => {
  const l = emptyLedger();
  recordAttempt(l, T2, false, ENV);
  recordAttempt(l, T2, false, ENV);
  assert.equal(recordAttempt(l, T2, false, { note: 'expected 2, received 3' }).status, 'open');
  recordAttempt(l, T2, false, ENV);
  assert.equal(
    recordAttempt(l, T2, false, ENV).status,
    'open',
    'two environment failures since the counted one',
  );
  assert.equal(recordAttempt(l, T2, false, ENV).status, 'env-blocked');

  const passing = emptyLedger();
  recordAttempt(passing, T2, false, ENV);
  recordAttempt(passing, T2, false, ENV);
  recordAttempt(passing, T2, true);
  assert.equal(recordAttempt(passing, T2, false, ENV).status, 'open', 'a pass also restarts the count');
  assert.equal(failuresOf(passing, T2), 0);
});

test('an env-blocked unit blocks its feature', () => {
  const l = emptyLedger();
  for (let i = 0; i < ENV_ATTEMPTS_TO_BLOCK; i += 1) recordAttempt(l, T2, false, ENV);
  assert.equal(featureBlocked(l, 'budget-v2'), true);
  assert.equal(featureBlocked(l, 'other-feature'), false);
});

test('keeps refused reruns apart', () => {
  const l = emptyLedger();
  recordAttempt(l, T2, false, { note: 'expected 2, received 3' });
  const before = structuredClone(l.units[T2]);
  const at = '2026-11-08T10:00:00.000Z';
  recordRefusal(l, T2, at);
  assert.deepEqual(l.refusals, [{ key: T2, at }]);
  assert.deepEqual(l.units[T2], before, 'the refused rerun is not an attempt');
  assert.equal(failuresOf(l, T2), 1);
  assert.equal(canAttempt(l, T2).attempt, 2);
});

test("keeps every reset and counts the orchestrator's", () => {
  const l = emptyLedger();
  const other = 'gate:budget-v2/T3';
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordAttempt(l, T2, false);
  assert.equal(
    reset(l, T2, { by: 'orchestrator', reason: 'Docker was stopped', at: '2026-11-08T11:00:00.000Z' }),
    true,
  );
  assert.equal(orchestratorResets(l, T2), 1);
  assert.equal(l.resets.length, 1);
  assert.equal(l.resets[0].reason, 'Docker was stopped');
  assert.equal(l.resets[0].previous.attempts.length, MAX_ATTEMPTS, 'the reset keeps what it cleared');

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordAttempt(l, T2, false);
  reset(l, T2, { by: 'pedro', reason: 'maintainer', at: '2026-11-08T12:00:00.000Z' });
  assert.equal(l.resets.length, 2, 'a later reset does not remove the earlier one');
  assert.equal(l.resets[0].by, 'orchestrator');
  assert.equal(orchestratorResets(l, T2), 1, 'a later maintainer reset does not hide the orchestrator reset');

  recordAttempt(l, other, false);
  reset(l, other, { by: 'orchestrator', reason: 'other', at: '2026-11-08T13:00:00.000Z' });
  assert.equal(orchestratorResets(l, T2), 1, 'another unit’s reset is not counted here');
  assert.equal(orchestratorResets(l, other), 1);
});

test('reports machine failures, refusals and resets apart', () => {
  const l = emptyLedger();
  recordAttempt(l, T2, false, { note: 'expected 2, received 3' });
  recordAttempt(l, T2, false, { ...ENV, note: 'Cannot connect to the Docker daemon' });
  recordRefusal(l, T2, '2026-11-08T10:30:00.000Z');
  const before = report(l);
  assert.ok(before.includes('| Environment failures | Refused reruns |'), 'the columns are there');
  assert.ok(before.includes(`| \`${T2}\` | open | 2 | 1 | 1 | 1 |`), before);
  reset(l, T2, {
    by: 'orchestrator',
    reason: 'Docker was stopped; started again',
    at: '2026-11-08T11:00:00.000Z',
  });
  const after = report(l);
  assert.ok(
    after.includes(
      `| \`${T2}\` | orchestrator | Docker was stopped; started again | 2026-11-08T11:00:00.000Z |`,
    ),
    after,
  );
});

test('reads a ledger written before budget v2', () => {
  const old = {
    version: 1,
    units: {
      'gate:f/T1': {
        status: 'open',
        attempts: [
          { at: '2026-11-01T10:00:00Z', ok: false, note: 'first' },
          { at: '2026-11-01T10:05:00Z', ok: false, note: 'second' },
        ],
      },
      'gate:f/T2': {
        status: 'passed',
        attempts: [
          {
            at: '2026-11-01T11:00:00Z',
            ok: true,
            note: 'ok',
            command: 'pnpm test',
            head: 'abc',
            clean: true,
          },
        ],
      },
    },
    resets: [
      {
        key: 'gate:f/T9',
        by: 'pedro',
        at: '2026-11-01T09:00:00Z',
        previous: { status: 'blocked', attempts: [] },
      },
    ],
  };
  assert.equal(failuresOf(old, 'gate:f/T1'), 2);
  assert.equal(envFailuresOf(old, 'gate:f/T1'), 0);
  assert.equal(canAttempt(old, 'gate:f/T1').attempt, 3);
  assert.equal(featureBlocked(old, 'f'), false);
  assert.equal(orchestratorResets(old, 'gate:f/T9'), 0, 'a maintainer reset is not an orchestrator reset');
  assert.equal(recordAttempt(old, 'gate:f/T1', false, { ...ENV }).status, 'open');
  assert.equal(failuresOf(old, 'gate:f/T1'), 2);
  assert.ok(report(old).includes('| `gate:f/T1` | open | 3 | 2 | 1 | 0 |'));
  assert.equal(mergeLedgers(old, emptyLedger()).units['gate:f/T1'].attempts.length, 3);
});

test('keeps one attempt and two retries', () => {
  assert.equal(MAX_RETRIES, 2);
  const l = emptyLedger();
  recordAttempt(l, T2, false);
  recordAttempt(l, T2, false);
  assert.equal(canAttempt(l, T2).attempt, 3, 'the third attempt is the last retry');
  assert.equal(recordAttempt(l, T2, false).status, 'blocked');
  assert.equal(canAttempt(l, T2).ok, false);
});
