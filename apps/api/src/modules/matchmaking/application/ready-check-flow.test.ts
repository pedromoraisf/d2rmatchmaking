import { describe, expect, it } from 'vitest';
import type { MatchFormedEvent } from '../../../shared-kernel/index.ts';
import { compareJoinOrder } from '../domain/queue-ticket/queue-ticket.ts';
import { queueSetup, START, type QueueSetup } from './testing/queue-setup.ts';

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

const SECOND = 1000;

/**
 * The deadline runs under the queue's lock, so the work it queued runs before any later queue call returns. Moving the
 * clock and then waiting for one queue call lets the deadline settle before the test reads its result.
 */
async function settleDeadlines(t: QueueSetup): Promise<void> {
  await t.queue.runMatcher();
}

/** Alice and Bob are queued and matched: the ready check is open with both. */
async function openDuel(t: QueueSetup): Promise<string> {
  t.readyPlayer('alice', 'c-sorc');
  t.readyPlayer('bob', 'c-hammer');
  await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
  await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
  const started = t.bus.readyChecksStarted();
  const check = started[0];
  if (check === undefined || started.length !== 1) {
    throw new Error('expected one ready check');
  }
  return check.readyCheckId;
}

describe('the ready check: opening (RDY-01)', () => {
  it('tells each member the deadline 60 seconds later, with the class and level of each member and no name', async () => {
    const t = queueSetup();
    const opened = t.clock.now();
    await openDuel(t);
    const started = t.bus.readyChecksStarted()[0];
    expect(started?.deadline).toBe(new Date(opened.getTime() + 60 * SECOND).toISOString());
    expect(started?.members).toStrictEqual([
      { accountId: 'alice', position: 1, characterClass: 'sorceress', level: 90, accepted: false },
      { accountId: 'bob', position: 2, characterClass: 'sorceress', level: 90, accepted: false },
    ]);
  });

  it('writes no MatchFormed while the check is open', async () => {
    const t = queueSetup();
    await openDuel(t);
    expect(t.outbox.appended.filter((event) => event.type === 'MatchFormed')).toHaveLength(0);
  });
});

describe('the ready check: accepting (RDY-02, RDY-03)', () => {
  it('tells every member that one member accepted, and writes MatchFormed when the last one accepts', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);

    expect((await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' })).ok).toBe(true);
    const updated = t.bus.published.flatMap((event) =>
      event.event.type === 'ReadyCheckUpdated' ? [event.event.payload] : [],
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.members.map((member) => member.accepted)).toStrictEqual([true, false]);
    expect(t.outbox.appended.filter((event) => event.type === 'MatchFormed')).toHaveLength(0);

    expect((await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'accept' })).ok).toBe(true);
    const formed = t.outbox.appended.filter(
      (event): event is MatchFormedEvent => event.type === 'MatchFormed',
    );
    expect(formed).toHaveLength(1);
    expect(formed[0]?.payload.members.map((member) => member.accountId)).toStrictEqual(['alice', 'bob']);
    expect(t.bus.readyChecksResolved()).toStrictEqual([
      { readyCheckId: checkId, outcome: 'accepted', accountIds: ['alice', 'bob'] },
    ]);
    expect(t.metrics.resolved).toStrictEqual(['accepted']);
  });

  it('accepts at 59.999 seconds and ends the check as timed out at 60.000 (RDY-05 boundary)', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    t.clock.advance(59_999);
    expect((await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' })).ok).toBe(true);
    t.clock.advance(1);
    await settleDeadlines(t);
    expect(t.bus.readyChecksResolved()[0]?.outcome).toBe('timed-out');
  });
});

describe('the ready check: declining (RDY-04)', () => {
  it('ends the check at once, with no penalty, and puts the accepted member back in the queue', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });

    expect((await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' })).ok).toBe(true);

    expect(t.bus.readyChecksResolved()[0]?.outcome).toBe('declined');
    expect(t.penalties.recorded).toHaveLength(0);
    expect((await t.store.all()).map((ticket) => ticket.accountId)).toStrictEqual(['alice']);
    expect(t.metrics.resolved).toStrictEqual(['declined']);
  });

  it('lets the decliner join the queue at once', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' });

    const again = await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    expect(again.ok).toBe(true);
  });

  it('keeps the accepted member ahead of a ticket that joined after the group', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    t.readyPlayer('cara', 'c-zon');
    t.clock.advance(5 * SECOND);
    await t.queue.joinQueue({ accountId: 'cara', request: duel('c-zon') });

    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' });

    // The matcher reads the queue in join order: Alice's original join instant puts her ahead of Cara.
    const inJoinOrder = [...(await t.store.all())].sort(compareJoinOrder);
    expect(inJoinOrder.map((ticket) => ticket.accountId)).toStrictEqual(['alice', 'cara']);
    expect(inJoinOrder[0]?.joinedAt).toStrictEqual(new Date(START.getTime()));
  });
});

describe('the ready check: the deadline (RDY-05)', () => {
  it('ends a check nobody answered as timed out, penalises both members for five minutes, and returns nobody to the queue', async () => {
    const t = queueSetup();
    await openDuel(t);
    t.clock.advance(60 * SECOND);
    await settleDeadlines(t);

    expect(t.bus.readyChecksResolved()[0]?.outcome).toBe('timed-out');
    expect(t.penalties.recorded).toStrictEqual([
      {
        accountIds: ['alice', 'bob'],
        until: new Date(t.clock.now().getTime() + 5 * 60 * SECOND),
        reason: 'ready-check-timeout',
      },
    ]);
    expect(await t.store.all()).toHaveLength(0);
  });

  it('returns the accepted member to the queue and penalises only the one who did not answer', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    t.clock.advance(60 * SECOND);
    await settleDeadlines(t);

    expect(t.penalties.recorded[0]?.accountIds).toStrictEqual(['bob']);
    expect((await t.store.all()).map((ticket) => ticket.accountId)).toStrictEqual(['alice']);
  });

  it('refuses the penalised member a join with ready-check-penalty and the seconds left, then lets them in after five minutes (RDY-05)', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    t.clock.advance(60 * SECOND);

    const refused = await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    expect(refused).toStrictEqual({ ok: false, error: { error: 'ready-check-penalty', secondsLeft: 300 } });

    t.clock.advance(4 * 60 * SECOND);
    const stillRefused = await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    expect(stillRefused).toStrictEqual({
      ok: false,
      error: { error: 'ready-check-penalty', secondsLeft: 60 },
    });

    t.clock.advance(60 * SECOND);
    const allowed = await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
    expect(allowed.ok).toBe(true);
  });
});

describe('the ready check: a member queues again only after the check ends (INV-04)', () => {
  it('refuses a second ticket with already-queued while the member is in an open check', async () => {
    const t = queueSetup();
    await openDuel(t);

    const again = await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    expect(again).toStrictEqual({ ok: false, error: 'already-queued' });
  });

  it('lets a member who was in a check that ended as declined join again', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' });

    expect((await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') })).ok).toBe(true);
  });
});

describe('the ready check: late, repeated and foreign answers (RDY-06)', () => {
  it('answers 409 ready-check-ended for an answer after the check ended, and changes nothing', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    t.clock.advance(60 * SECOND);
    await settleDeadlines(t);

    const late = await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    expect(late).toStrictEqual({ ok: false, error: 'ready-check-ended' });
    expect(t.bus.readyChecksResolved()).toHaveLength(1);
  });

  it('answers 409 already-answered for a second acceptance', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });

    const repeated = await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    expect(repeated).toStrictEqual({ ok: false, error: 'already-answered' });
  });

  it('answers 404 not-found for a player who is not in the check, and for an unknown check', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    t.readyPlayer('cara', 'c-zon');

    expect(await t.queue.answerReadyCheck({ accountId: 'cara', checkId, answer: 'accept' })).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
    expect(
      await t.queue.answerReadyCheck({ accountId: 'alice', checkId: 'no-such-check', answer: 'accept' }),
    ).toStrictEqual({ ok: false, error: 'not-found' });
  });
});

describe('the ready check: reading the open check (RDY-11)', () => {
  it('shows an open check to each member and to no one else', async () => {
    const t = queueSetup();
    await openDuel(t);
    expect((await t.queue.openReadyCheckOf({ accountId: 'alice' }))?.members).toHaveLength(2);
    expect(await t.queue.openReadyCheckOf({ accountId: 'cara' })).toBeNull();
  });

  it('shows nothing once the check has ended', async () => {
    const t = queueSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' });
    expect(await t.queue.openReadyCheckOf({ accountId: 'alice' })).toBeNull();
  });

  it('shows nothing at the deadline, even before the timer has settled it', async () => {
    const t = queueSetup();
    await openDuel(t);
    t.clock.advance(60 * SECOND);
    expect(await t.queue.openReadyCheckOf({ accountId: 'alice' })).toBeNull();
  });
});
