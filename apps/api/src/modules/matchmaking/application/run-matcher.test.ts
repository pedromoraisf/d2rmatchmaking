import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchFormedEvent } from '../../../shared-kernel/index.ts';
import { queueSetup, READY_CHARACTER } from './testing/queue-setup.ts';

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

describe('runMatcher: a match (QUE-12)', () => {
  it('writes MatchFormed to the outbox and takes the grouped tickets out of the queue', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    // Bob's ticket is in the queue but was not matched on his join, so only the matcher run can pair them.
    await t.store.add({
      id: 'bob-ticket',
      accountId: 'bob',
      characterId: 'c-hammer',
      mode: 'pvp',
      region: 'americas',
      difficulty: 'hell',
      ladder: 'sc-ladder',
      era: 'rotw',
      rating: 1500,
      level: 90,
      joinedAt: new Date(t.clock.now().getTime() + 1000),
      pvp: { format: 'duel', rules: 'gm' },
    });

    await t.queue.runMatcher();

    expect(await t.store.all()).toHaveLength(0);
    const formed = t.outbox.appended.filter(
      (event): event is MatchFormedEvent => event.type === 'MatchFormed',
    );
    expect(formed).toHaveLength(1);
    expect(formed[0]?.payload).toMatchObject({
      mode: 'pvp',
      activity: 'pvp',
      difficulty: 'hell',
      region: 'americas',
      ladder: 'sc-ladder',
      era: 'rotw',
      members: [
        { accountId: 'alice', characterId: 'c-sorc', joinOrder: 1, role: 'host' },
        { accountId: 'bob', characterId: 'c-hammer', joinOrder: 2, role: 'member' },
      ],
    });
  });

  it('tells each grouped player that the ticket left because it matched', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });

    expect(t.bus.leaveReasons()).toStrictEqual(['matched', 'matched']);
  });

  it('reports the wait of each grouped ticket in seconds', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    t.clock.advance(65_000);
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });

    expect(t.metrics.waits.map((wait) => wait.seconds)).toStrictEqual([65, 0]);
    expect(t.metrics.waits[0]?.attributes).toStrictEqual({
      mode: 'pvp',
      difficulty: 'hell',
      ladder: 'sc-ladder',
      era: 'rotw',
    });
  });

  it('reports the pool as empty once its players are grouped', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    t.readyPlayer('bob', 'c-hammer');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });

    const latest = [...t.metrics.sizes].reverse().find((entry) => entry.attributes.difficulty === 'hell');
    expect(latest?.size).toBe(0);
  });
});

describe('runMatcher: a waiting ticket', () => {
  it('is not told again while its band and pool stay the same', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    const before = t.bus.queueUpdates().length;

    await t.queue.runMatcher();

    expect(t.bus.queueUpdates().length).toBe(before);
  });

  it('is told its widened band after 30 seconds of waiting', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    t.clock.advance(30_000);

    await t.queue.runMatcher();

    const last = t.bus.queueUpdates().at(-1);
    expect(last).toMatchObject({
      accountId: 'alice',
      update: { status: 'waiting', band: { low: 1425, high: 1575 } },
    });
  });

  it('sends the site a view with no account id: the stream routes by account, the body names nobody', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc', READY_CHARACTER);
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });

    const bodies = t.bus.queueUpdates().map(({ update }) => JSON.stringify(update));
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => !body.includes('alice'))).toBe(true);
  });
});

describe('runMatcher: an idle tick (T8)', () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
    );
  });

  it('records no pool size and no matcher span when nobody is queued', async () => {
    const t = queueSetup();
    exporter.reset();

    await t.queue.runMatcher();

    expect(t.metrics.sizes).toHaveLength(0);
    expect(exporter.getFinishedSpans().filter((span) => span.name === 'matchmaking.match')).toHaveLength(0);
  });

  it('records the matcher span on a tick that has a ticket to look at', async () => {
    const t = queueSetup();
    t.readyPlayer('alice', 'c-sorc');
    await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
    exporter.reset();

    await t.queue.runMatcher();

    expect(exporter.getFinishedSpans().filter((span) => span.name === 'matchmaking.match')).toHaveLength(1);
  });
});
