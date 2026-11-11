import { describe, expect, it } from 'vitest';
import type { MatchFormedEvent } from '../../../shared-kernel/index.ts';
import type { QueueJoinInput } from './join-queue.ts';
import { queueSetup, READY_CHARACTER, START } from './testing/queue-setup.ts';

const pvp = (overrides: Partial<Extract<QueueJoinInput, { mode: 'pvp' }>> = {}): QueueJoinInput => ({
  mode: 'pvp',
  characterId: 'c-sorc',
  difficulty: 'hell',
  region: 'americas',
  format: 'duel',
  rules: 'gm',
  ...overrides,
});

const leveling = (
  overrides: Partial<Extract<QueueJoinInput, { mode: 'leveling' }>> = {},
): QueueJoinInput => ({
  mode: 'leveling',
  characterId: 'c-zon',
  difficulty: 'nightmare',
  region: 'americas',
  activity: 'chaos',
  role: 'killer',
  minLevel: 40,
  ...overrides,
});

describe('joinQueue: a ready player (QUE-01, QUE-02)', () => {
  it('answers a waiting ticket for a PvP join with its band and pool', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');

    const result = await t.queue.joinQueue({ accountId: 'alice', request: pvp() });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 't-1',
        status: 'waiting',
        mode: 'pvp',
        joinedAt: '2026-11-10T12:00:00.000Z',
        band: { low: 1450, high: 1550 },
        poolSize: 1,
        options: {
          mode: 'pvp',
          characterId: 'c-sorc',
          difficulty: 'hell',
          region: 'americas',
          format: 'duel',
          rules: 'gm',
        },
      },
    });
    expect(await t.queue.myTicket({ accountId: 'alice' })).not.toBeNull();
  });

  it('answers a waiting ticket for a leveling join with no band', async () => {
    const t = queueSetup();
    t.readyPlayer('cara', 'c-zon', {
      ...READY_CHARACTER,
      level: 45,
      unlockedDifficulties: ['normal', 'nightmare'],
    });

    const result = await t.queue.joinQueue({ accountId: 'cara', request: leveling({ minLevel: 40 }) });

    expect(result).toMatchObject({
      ok: true,
      value: {
        mode: 'leveling',
        band: null,
        options: { mode: 'leveling', activity: 'chaos', role: 'killer', minLevel: 40 },
      },
    });
  });

  it('keeps the derived ladder and era on the ticket and the span-facing attributes', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc', {
      ...READY_CHARACTER,
      hardcore: true,
      ladder: 'non-ladder',
      era: 'lod',
    });

    await t.queue.joinQueue({ accountId: 'alice', request: pvp({ difficulty: 'nightmare' }) });

    expect(t.metrics.sizes.at(-1)).toStrictEqual({
      attributes: { mode: 'pvp', difficulty: 'nightmare', ladder: 'hc-nonladder', era: 'lod' },
      size: 1,
    });
  });

  it('publishes the waiting view to the site', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');

    await t.queue.joinQueue({ accountId: 'alice', request: pvp() });

    expect(t.bus.queueUpdates()).toHaveLength(1);
    expect(t.bus.queueUpdates()[0]?.accountId).toBe('alice');
  });
});

describe('joinQueue: join order (QUE-11, QUE-12)', () => {
  it('gives two joins at the same clock instant different instants, the first earlier', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('cara', 'c-zon');
    await t.queue.joinQueue({ accountId: 'alice', request: pvp({ rules: 'gm' }) });
    await t.queue.joinQueue({ accountId: 'cara', request: pvp({ characterId: 'c-zon', rules: 'bm' }) });

    const [first, second] = await t.store.all();
    expect(first?.joinedAt.getTime()).toBeLessThan(second?.joinedAt.getTime() ?? 0);
  });
});

describe('joinQueue: refusals (QUE-03 … QUE-06)', () => {
  it("refuses a character that is not the player's and creates no ticket", async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');

    const result = await t.queue.joinQueue({
      accountId: 'alice',
      request: pvp({ characterId: 'someone-else' }),
    });

    expect(result).toStrictEqual({ ok: false, error: 'not-your-character' });
    expect(await t.store.all()).toHaveLength(0);
  });

  it('refuses a character whose ladder and era are not declared', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc', { ...READY_CHARACTER, ladder: null });

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'undeclared-character',
    });
  });

  it('refuses a difficulty the character has not unlocked', async () => {
    const t = queueSetup();
    t.readyPlayer('cara', 'c-zon', {
      ...READY_CHARACTER,
      level: 45,
      unlockedDifficulties: ['normal', 'nightmare'],
    });

    expect(
      await t.queue.joinQueue({ accountId: 'cara', request: pvp({ characterId: 'c-zon' }) }),
    ).toStrictEqual({
      ok: false,
      error: 'difficulty-locked',
    });
  });

  it.each([
    ['below-minimum-level', { minLevel: 50 }],
    ['minimum-below-floor', { minLevel: 39 }],
  ] as const)('refuses a leveling join with %s', async (error, overrides) => {
    const t = queueSetup();
    t.readyPlayer('cara', 'c-zon', {
      ...READY_CHARACTER,
      level: 45,
      unlockedDifficulties: ['normal', 'nightmare'],
    });

    expect(
      await t.queue.joinQueue({
        accountId: 'cara',
        request: leveling({ characterId: 'c-zon', ...overrides }),
      }),
    ).toStrictEqual({
      ok: false,
      error,
    });
  });

  it('refuses Heralds outside Hell', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');

    expect(
      await t.queue.joinQueue({
        accountId: 'alice',
        request: leveling({ characterId: 'c-sorc', activity: 'heralds', difficulty: 'nightmare' }),
      }),
    ).toStrictEqual({ ok: false, error: 'activity-not-available' });
  });

  it('refuses a player whose agent is offline', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setOnline('alice', false);

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'agent-offline',
    });
  });

  it('refuses a player with no Battle.net account', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setLinked('alice', false);

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'not-linked',
    });
  });

  it('refuses a player with no open site stream', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setSiteOpen('alice', false);

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'site-not-open',
    });
  });

  it('refuses a player who is a member of an open room', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setInRoom('alice', true);

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'in-room',
    });
  });

  it('refuses a second ticket while the first waits, and keeps the first one (QUE-06)', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: pvp({ rules: 'gm' }) });

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp({ rules: 'bm' }) })).toStrictEqual({
      ok: false,
      error: 'already-queued',
    });
    const queued = await t.store.all();
    expect(queued).toHaveLength(1);
    const only = queued[0];
    expect(only?.mode === 'pvp' ? only.pvp.rules : null).toBe('gm');
  });

  it('publishes nothing for a refused join', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.facts.setOnline('alice', false);

    await t.queue.joinQueue({ accountId: 'alice', request: pvp() });

    expect(t.bus.published).toHaveLength(0);
  });
});

describe('joinQueue: the matcher runs on a join (QUE-11, QUE-12)', () => {
  it('opens a ready check the moment the second compatible player joins, and forms the duel once both accept', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'alice', request: pvp() });

    const bob = await t.queue.joinQueue({ accountId: 'bob', request: pvp({ characterId: 'c-hammer' }) });

    expect(bob.ok).toBe(true);
    expect(await t.store.all()).toHaveLength(0);
    const check = t.bus.readyChecksStarted();
    expect(check.map((started) => started.members.map((member) => member.accountId))).toStrictEqual([
      ['alice', 'bob'],
    ]);
    expect(t.outbox.appended.filter((event) => event.type === 'MatchFormed')).toHaveLength(0);

    for (const accountId of ['alice', 'bob']) {
      const answered = await t.queue.answerReadyCheck({
        accountId,
        checkId: check[0]?.readyCheckId ?? '',
        answer: 'accept',
      });
      expect(answered.ok).toBe(true);
    }
    const formed = t.outbox.appended.filter(
      (event): event is MatchFormedEvent => event.type === 'MatchFormed',
    );
    expect(formed).toHaveLength(1);
    expect(formed[0]?.payload.members.map((member) => member.accountId)).toStrictEqual(['alice', 'bob']);
    expect(formed[0]?.payload.members[0]?.role).toBe('host');
  });
});

describe('joinQueue: the limits (QUE-18, QUE-19)', () => {
  it('refuses the eleventh attempt in a minute with too-many-joins, and changes nothing (QUE-18)', async () => {
    const t = queueSetup();
    // Attempts count whatever they answer: an account with no Battle.net link is refused with not-linked each time.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
        ok: false,
        error: 'not-linked',
      });
    }
    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'too-many-joins',
    });
    expect(await t.store.all()).toHaveLength(0);
    expect(t.bus.published).toHaveLength(0);
  });

  it('keeps refusing until a full minute has passed since the oldest attempt (QUE-18)', async () => {
    const t = queueSetup();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await t.queue.joinQueue({ accountId: 'alice', request: pvp() });
    }
    t.clock.advance(59_999);
    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'too-many-joins',
    });
    t.clock.advance(1);
    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'not-linked',
    });
  });

  it('limits each account on its own, so another player is not refused (QUE-18)', async () => {
    const t = queueSetup();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await t.queue.joinQueue({ accountId: 'alice', request: pvp() });
    }
    expect(await t.queue.joinQueue({ accountId: 'bob', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'not-linked',
    });
  });

  /** A waiting duel ticket, `60` ratings from the next, so no two are in each other's band (QUE-08). */
  const spacedTicket = (index: number) => ({
    id: `w${index}`,
    accountId: `w-account-${index}`,
    characterId: `w-char-${index}`,
    characterClass: 'sorceress' as const,
    mode: 'pvp' as const,
    region: 'americas' as const,
    difficulty: 'hell' as const,
    ladder: 'sc-ladder' as const,
    era: 'rotw' as const,
    rating: 1500 + 60 * (index + 1),
    level: 90,
    joinedAt: new Date(START),
    pvp: { format: 'duel' as const, rules: 'gm' as const },
  });

  it('refuses a join into a pool that holds 2,000 waiting tickets with queue-full, and leaves the queue as it was (QUE-19)', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    for (let index = 0; index < 2000; index += 1) {
      await t.store.add(spacedTicket(index));
    }

    expect(await t.queue.joinQueue({ accountId: 'alice', request: pvp() })).toStrictEqual({
      ok: false,
      error: 'queue-full',
    });
    expect(await t.store.all()).toHaveLength(2000);
    expect(await t.store.byAccount('alice')).toBeUndefined();
    expect(t.bus.published).toHaveLength(0);
  });

  it('admits the join that makes a pool 2,000 tickets (QUE-19)', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    for (let index = 0; index < 1999; index += 1) {
      await t.store.add(spacedTicket(index));
    }

    const joined = await t.queue.joinQueue({ accountId: 'alice', request: pvp() });

    expect(joined.ok).toBe(true);
    expect(await t.store.all()).toHaveLength(2000);
  });

  it('does not count a full pool against a join into another pool (QUE-19)', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    for (let index = 0; index < 2000; index += 1) {
      await t.store.add(spacedTicket(index));
    }

    const joined = await t.queue.joinQueue({ accountId: 'alice', request: pvp({ rules: 'bm' }) });

    expect(joined.ok).toBe(true);
  });
});
