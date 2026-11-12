import { describe, expect, it } from 'vitest';
import type { QueueTicket } from '../../domain/queue-ticket/queue-ticket.ts';
import { MemoryQueueStore } from './memory-queue-store.ts';

const ticket = (id: string, accountId: string): QueueTicket => ({
  id,
  accountId,
  characterId: `char-${accountId}`,
  characterClass: 'sorceress',
  mode: 'pvp',
  region: 'americas',
  difficulty: 'hell',
  ladder: 'sc-ladder',
  era: 'rotw',
  rating: 1500,
  level: 90,
  joinedAt: new Date('2026-11-10T12:00:00.000Z'),
  pvp: { format: 'duel', rules: 'gm' },
});

describe('MemoryQueueStore', () => {
  it('finds a ticket by its id and by its account, and lists them in join order', async () => {
    const store = new MemoryQueueStore();
    await store.add(ticket('t1', 'alice'));
    await store.add(ticket('t2', 'bob'));

    expect((await store.find('t2'))?.accountId).toBe('bob');
    expect((await store.byAccount('alice'))?.id).toBe('t1');
    expect((await store.all()).map((queued) => queued.id)).toStrictEqual(['t1', 't2']);
  });

  it('removes a ticket from both indexes, and ignores an id that is not queued', async () => {
    const store = new MemoryQueueStore();
    await store.add(ticket('t1', 'alice'));
    await store.add(ticket('t2', 'bob'));

    await store.remove(['t1', 'no-such-ticket']);

    expect(await store.find('t1')).toBeUndefined();
    expect(await store.byAccount('alice')).toBeUndefined();
    expect((await store.all()).map((queued) => queued.id)).toStrictEqual(['t2']);
  });

  it('empties both indexes on clear', async () => {
    const store = new MemoryQueueStore();
    await store.add(ticket('t1', 'alice'));

    store.clear();

    expect(await store.all()).toStrictEqual([]);
    expect(await store.byAccount('alice')).toBeUndefined();
  });
});
