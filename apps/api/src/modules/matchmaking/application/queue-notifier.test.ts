import { describe, expect, it } from 'vitest';
import type { QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';
import { createQueueNotifier } from './queue-notifier.ts';
import { RecordingEventBus, RecordingQueueMetrics } from './testing/queue-fakes.ts';
import { queueSetup } from './testing/queue-setup.ts';

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

/** One waiting ticket, made by a real join, and a notifier of its own over a recording bus. */
async function notifierWithTicket() {
  const t = queueSetup();
  t.readyPlayer('alice', 'c-sorc');
  await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
  const ticket = (await t.store.all())[0] as QueueTicket;
  const bus = new RecordingEventBus();
  const metrics = new RecordingQueueMetrics();
  return { ticket, now: t.clock.now(), bus, metrics, notifier: createQueueNotifier({ bus, metrics }) };
}

describe('the queue notifier: what the site is told (QUE-14, QUE-15)', () => {
  it('tells the site the waiting view of a ticket at once, with the size of its pool', async () => {
    const { ticket, now, bus, notifier } = await notifierWithTicket();

    await notifier.waiting(ticket, now, 3);

    expect(bus.queueUpdates()).toStrictEqual([
      {
        accountId: 'alice',
        update: expect.objectContaining({ id: ticket.id, status: 'waiting', poolSize: 3 }),
      },
    ]);
    expect(bus.published[0]?.kind).toBe('transient');
  });

  it('does not repeat a view the site already has, whether it came from waiting or from refresh', async () => {
    const { ticket, now, bus, notifier } = await notifierWithTicket();

    await notifier.refresh([ticket], now);
    await notifier.refresh([ticket], now);
    expect(bus.queueUpdates()).toHaveLength(1);

    await notifier.waiting(ticket, now, 1);
    await notifier.refresh([ticket], now);
    expect(bus.queueUpdates()).toHaveLength(2);
  });

  it('tells the site again when the pool size changed since it was last told', async () => {
    const { ticket, now, bus, notifier } = await notifierWithTicket();
    await notifier.waiting(ticket, now, 2);

    await notifier.refresh([ticket], now);

    expect(bus.queueUpdates().map(({ update }) => (update as { poolSize: number }).poolSize)).toStrictEqual([
      2, 1,
    ]);
  });

  it('forgets a ticket that is no longer waiting, so it is told afresh when it comes back', async () => {
    const { ticket, now, bus, notifier } = await notifierWithTicket();
    await notifier.waiting(ticket, now, 1);

    await notifier.refresh([], now);
    await notifier.refresh([ticket], now);

    expect(bus.queueUpdates()).toHaveLength(2);
  });

  it('forgets a ticket that left, and tells the site the reason', async () => {
    const { ticket, now, bus, notifier } = await notifierWithTicket();
    await notifier.waiting(ticket, now, 1);

    await notifier.left(ticket, 'left-by-player');
    await notifier.refresh([ticket], now);

    expect(bus.queueUpdates().map(({ update }) => (update as { status: string }).status)).toStrictEqual([
      'waiting',
      'left',
      'waiting',
    ]);
    expect(bus.leaveReasons()).toStrictEqual(['left-by-player']);
  });
});
