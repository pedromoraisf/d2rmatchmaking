import { describe, expect, it } from 'vitest';
import { createSerialLock } from './serial-lock.ts';
import { queueSetup } from './testing/queue-setup.ts';

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

describe('leaveQueue (QUE-13)', () => {
  it('removes the player’s own ticket and reports the leave to the site', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    const joined = await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    const ticketId = joined.ok ? joined.value.id : '';

    const result = await t.queue.leaveQueue({ accountId: 'alice', ticketId });

    expect(result).toStrictEqual({ ok: true, value: undefined });
    expect(await t.queue.myTicket({ accountId: 'alice' })).toBeNull();
    expect(t.bus.leaveReasons()).toStrictEqual(['left-by-player']);
  });

  it('answers not-found for a ticket that is someone else’s and removes nothing', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    const joined = await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    const ticketId = joined.ok ? joined.value.id : '';

    expect(await t.queue.leaveQueue({ accountId: 'bob', ticketId })).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await t.queue.myTicket({ accountId: 'alice' })).not.toBeNull();
  });

  it('answers not-found for an unknown ticket', async () => {
    const t = queueSetup();
    expect(await t.queue.leaveQueue({ accountId: 'alice', ticketId: 'nope' })).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
  });
});

describe('dropTicket (QUE-14)', () => {
  it.each(['agent-offline', 'agent-revoked', 'site-closed'] as const)(
    'removes the ticket and tells the site why (%s)',
    async (reason) => {
      const t = queueSetup();
      t.readyPlayer('alice', 'c-sorc');
      await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });

      await t.queue.dropTicket({ accountId: 'alice', reason });

      expect(await t.queue.myTicket({ accountId: 'alice' })).toBeNull();
      expect(t.bus.leaveReasons().at(-1)).toBe(reason);
    },
  );

  it('does nothing for an account with no ticket', async () => {
    const t = queueSetup();
    await t.queue.dropTicket({ accountId: 'alice', reason: 'agent-offline' });
    expect(t.bus.published).toHaveLength(0);
  });
});

describe('myTicket (QUE-15)', () => {
  it('answers null when the player is not queued', async () => {
    const t = queueSetup();
    expect(await t.queue.myTicket({ accountId: 'alice' })).toBeNull();
  });

  it('shows the pool: the compatible tickets that wait, the ticket included, and no names', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('cara', 'c-zon');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    await t.queue.joinQueue({ accountId: 'cara', request: { ...duel('c-zon'), region: 'europe' } });

    const mine = await t.queue.myTicket({ accountId: 'alice' });

    expect(mine).toMatchObject({ status: 'waiting', poolSize: 1 });
    expect(JSON.stringify(mine)).not.toContain('cara');
  });

  it('shows the band widened by the time waited', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    t.clock.advance(65_000);

    expect(await t.queue.myTicket({ accountId: 'alice' })).toMatchObject({ band: { low: 1400, high: 1600 } });
  });
});

describe('the queue lock', () => {
  it('runs the work one piece at a time, in call order', async () => {
    const lock = createSerialLock();
    const order: string[] = [];
    const slow = lock.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
    });
    const quick = lock.run(async () => {
      order.push('second');
    });
    await Promise.all([slow, quick]);
    expect(order).toStrictEqual(['first', 'second']);
  });

  it('keeps running after a piece of work throws', async () => {
    const lock = createSerialLock();
    const failing = lock.run(async () => {
      throw new Error('boom');
    });
    const next = lock.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('lets two concurrent joins and a matcher run form one match, not two', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    t.readyPlayer('cara', 'c-zon');

    await Promise.all([
      t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') }),
      t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') }),
      t.queue.runMatcher(),
      t.queue.joinQueue({ accountId: 'cara', request: duel('c-zon') }),
    ]);

    const formed = t.outbox.appended.filter((event) => event.type === 'MatchFormed');
    expect(formed).toHaveLength(1);
    expect(await t.store.all()).toHaveLength(1);
  });
});
