import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exitCodeOf, leave } from '../staging/lib/cleanup.mjs';
import { createLog, summaryOf } from '../staging/lib/log.mjs';
import { buildPlan } from '../staging/lib/plan.mjs';

const quiet = { line() {} };

test('SBT-10 the steps run in order and a failed step does not stop the rest', async () => {
  const order = [];
  const result = await leave({
    name: 'bot-k7-1',
    log: quiet,
    steps: [
      ['room-or-ticket', async () => order.push('room')],
      [
        'agent',
        async () => {
          order.push('agent');
          throw new Error('boom');
        },
      ],
      ['session', async () => order.push('session')],
      ['streams', async () => order.push('streams')],
    ],
  });
  assert.deepEqual(order, ['room', 'agent', 'session', 'streams']);
  assert.deepEqual(result.failed, ['agent']);
  assert.equal(exitCodeOf([result]), 1);
  assert.equal(exitCodeOf([{ name: 'a', failed: [] }]), 0);
});

test('SBT-11 a secret the run holds never reaches a log line or the summary', () => {
  const lines = [];
  const log = createLog({ write: (line) => lines.push(line) });
  log.secret('d2rmm_a_SECRETTOKENVALUE');
  log.secret('secretsession1abc');
  log.line('x', { note: 'token d2rmm_a_SECRETTOKENVALUE and secretsession1abc' });
  assert.ok(!lines.join('').includes('SECRETTOKENVALUE'));
  assert.ok(!lines.join('').includes('secretsession1abc'));
  const plan = buildPlan({ mode: 'pvp', difficulty: 'hell', ladder: 'ladder', era: 'rotw' }, 'k7');
  const summary = summaryOf({
    plan,
    outcomes: [
      {
        name: 'bot-k7-1',
        room: 'room-d2rmm_a_SECRETTOKENVALUE',
        stages: ['created', 'closed'],
        left: 'clean',
      },
    ],
    scrub: log.scrub,
  });
  assert.ok(!summary.includes('SECRETTOKENVALUE'));
  assert.match(summary, /bot-k7-1/);
  assert.match(summary, /created → closed/);
});
