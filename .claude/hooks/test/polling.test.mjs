import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../lib/shell-parse.mjs';
import {
  sleepSeconds,
  pollingLoop,
  pollingDecision,
  repeatDecision,
  POLLING_REASON,
} from '../lib/polling.mjs';

const parsed = (line) => parseLine(line);
const denies = (line) => pollingDecision(parsed(line))?.decision === 'deny';

test('adds up sleeps', () => {
  assert.equal(denies('sleep 30'), false);
  assert.equal(sleepSeconds(parsed('sleep 30')), 30);
  assert.equal(denies('sleep 31'), true);
  assert.equal(sleepSeconds(parsed('sleep 1m')), 60);
  assert.equal(denies('sleep 1m'), true);
  assert.equal(denies('sleep 20 && sleep 20'), true);
  assert.equal(sleepSeconds(parsed('sleep 20 && sleep 20')), 40);
  assert.equal(denies('sleep infinity'), true);
  assert.equal(denies('sleep $N'), true);
  assert.equal(denies('sleep 1e2'), true);
  assert.equal(denies('bash -c "sleep 40"'), true);
  assert.equal(denies('env sleep 40'), true);
  assert.equal(denies('timeout 5 sleep 40'), true);
  assert.equal(denies('command sleep 40'), true);
  assert.equal(denies('\\sleep 40'), true);
  assert.equal(denies('FOO=1 sleep 40'), true);
  assert.equal(denies('/bin/sleep 40'), true);
  assert.equal(denies('sleep 1h'), true);
  assert.equal(denies('sleep 0.5'), false);
  assert.equal(denies('sleep 10 20'), false);
  assert.equal(denies('sleep 10 21'), true);
  assert.equal(denies('xargs sleep 5'), true);
  assert.equal(denies('echo 5 | xargs -I{} sleep {}'), true);
  assert.equal(denies('sleep'), false);
  assert.equal(denies('git status'), false);
});

test('refuses polling loops', () => {
  assert.equal(pollingLoop(parsed('while true; do sleep 1; done')), true);
  assert.equal(pollingLoop(parsed('until x; do sleep 1; done')), true);
  assert.equal(pollingLoop(parsed('watch git status')), true);
  assert.equal(pollingLoop(parsed('bash -c "while true; do sleep 1; done"')), true);
  assert.equal(denies('while true; do sleep 1; done'), true);
  assert.equal(denies('until x; do sleep 1; done'), true);
  assert.equal(denies('watch git status'), true);
  assert.equal(pollingLoop(parsed('for f in a b; do cat "$f"; done')), false);
  assert.equal(denies('for f in a b; do cat a; done'), false);
  assert.equal(denies('git status && git log -1'), false);
});

test('refuses the fifth identical call within ten minutes', () => {
  const sid = 'session-a';
  const minute = 60_000;
  let history = { version: 1, sessions: {} };
  const run = (command, now) => {
    const result = repeatDecision(command, sid, history, now);
    for (const effect of result.effects) {
      const list = history.sessions[effect.sid] ?? [];
      history = {
        ...history,
        sessions: { ...history.sessions, [effect.sid]: [...list, { hash: effect.hash, at: effect.at }] },
      };
    }
    return result.decision;
  };
  assert.equal(run('gh pr view 1', 0), null);
  assert.equal(run('gh pr view 1', minute), null);
  assert.equal(run('  gh pr view 1  ', 2 * minute), null);
  assert.equal(run('gh pr view 1', 3 * minute), null, 'the fourth identical call passes');
  assert.equal(run('gh pr view 1', 4 * minute), 'deny', 'the fifth denies');
  assert.equal(run('gh pr view 1', 5 * minute), 'deny', 'a denied call still counts');
  assert.equal(run('gh pr view 2', 4 * minute), null, 'another command is counted apart');

  const hashOf = (command) => repeatDecision(command, sid, { sessions: {} }, 0).effects[0].hash;
  const four = { version: 1, sessions: { [sid]: [0, 0, 0, 0].map((at) => ({ hash: hashOf('x'), at })) } };
  assert.equal(
    repeatDecision('x', sid, four, 10 * minute - 1).decision,
    'deny',
    'inside the window it denies',
  );
  assert.equal(
    repeatDecision('x', sid, four, 10 * minute).decision,
    null,
    'a fifth call after ten minutes passes',
  );
  assert.equal(repeatDecision('x', 'other-session', four, 1).decision, null, 'sessions are apart');
});

test('says to wait for the notification', () => {
  assert.match(POLLING_REASON, /background/);
  assert.match(POLLING_REASON, /task notification/);
  assert.equal(pollingDecision(parsed('sleep 40'))?.reason, POLLING_REASON);
  assert.equal(pollingDecision(parsed('while true; do sleep 1; done'))?.reason, POLLING_REASON);
  assert.equal(pollingDecision(parsed('watch git status'))?.reason, POLLING_REASON);
  const store = { version: 1, sessions: {} };
  let state = store;
  for (let n = 0; n < 5; n++) {
    const r = repeatDecision('ls', 's', state, n);
    state = { sessions: { s: [...(state.sessions.s ?? []), { hash: r.effects[0].hash, at: n }] } };
    if (r.decision === 'deny') assert.equal(r.reason, POLLING_REASON);
  }
});
