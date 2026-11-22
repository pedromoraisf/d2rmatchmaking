// The side effects of the ready check's flow that the outcome alone does not show: the timers it sets and cancels, the
// store it prunes and the queue it reports to (RDY-04, RDY-05, RDY-06).
import { describe, expect, it } from 'vitest';
import {
  FakeClock,
  FakeScheduler,
  SequentialIdGenerator,
  type Cancel,
  type Scheduler,
} from '../../../shared-kernel/index.ts';
import { JOIN_LIMIT } from '../domain/queue-limits.ts';
import { ENDED_CHECK_KEEP_MS } from './ready-check-flow.ts';
import { createQueueUseCases } from './queue-use-cases.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import {
  FakeAccountFacts,
  FakeCharacters,
  FixedRatings,
  InMemoryJoinLimits,
  InMemoryPenalties,
  InMemoryQueueStore,
  InMemoryReadyChecks,
  RecordingEventBus,
  RecordingQueueMetrics,
} from './testing/queue-fakes.ts';
import { READY_CHARACTER, START } from './testing/queue-setup.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const SECOND = 1000;

const duel = (characterId: string) => ({
  mode: 'pvp' as const,
  characterId,
  difficulty: 'hell' as const,
  region: 'americas' as const,
  format: 'duel' as const,
  rules: 'gm' as const,
});

/** A scheduler that counts the timers it was asked to cancel; `ignoreCancel` makes a cancel a no-op (a late timer). */
class SpyScheduler implements Scheduler {
  cancelled = 0;
  readonly #inner: FakeScheduler;
  readonly #ignoreCancel: boolean;

  constructor(clock: FakeClock, ignoreCancel: boolean) {
    this.#inner = new FakeScheduler(clock);
    this.#ignoreCancel = ignoreCancel;
  }

  every(ms: number, fn: () => void): Cancel {
    return this.#inner.every(ms, fn);
  }

  at(time: Date, fn: () => void): Cancel {
    const cancel = this.#inner.at(time, fn);
    return () => {
      this.cancelled += 1;
      if (!this.#ignoreCancel) {
        cancel();
      }
    };
  }
}

/** Remembers what the flow asked to prune. */
class PruneRecordingChecks extends InMemoryReadyChecks {
  readonly pruned: Date[] = [];

  override async pruneEndedBefore(before: Date): Promise<void> {
    this.pruned.push(before);
    await super.pruneEndedBefore(before);
  }
}

function flowSetup(options: { readonly ignoreCancel?: boolean } = {}) {
  const clock = new FakeClock(START);
  const store = new InMemoryQueueStore();
  const characters = new FakeCharacters();
  const facts = new FakeAccountFacts();
  const bus = new RecordingEventBus();
  const metrics = new RecordingQueueMetrics();
  const outbox = new RecordingOutbox();
  const checks = new PruneRecordingChecks();
  const scheduler = new SpyScheduler(clock, options.ignoreCancel ?? false);
  const queue = createQueueUseCases({
    store,
    joinLimits: new InMemoryJoinLimits(JOIN_LIMIT),
    characters,
    presence: facts,
    links: facts,
    sites: facts,
    rooms: facts,
    ratings: new FixedRatings(),
    checks,
    penalties: new InMemoryPenalties(),
    scheduler,
    onError: (error) => {
      throw error;
    },
    ids: new SequentialIdGenerator('t'),
    clock,
    uow: new InMemoryUnitOfWork(),
    outbox,
    bus,
    metrics,
  });
  const readyPlayer = (accountId: string, characterId: string) => {
    facts.readyToQueue(accountId);
    characters.set(accountId, characterId, READY_CHARACTER);
  };
  return { clock, store, bus, metrics, outbox, checks, scheduler, queue, readyPlayer };
}

type FlowSetup = ReturnType<typeof flowSetup>;

async function openDuel(t: FlowSetup): Promise<string> {
  t.readyPlayer('alice', 'c-sorc');
  t.readyPlayer('bob', 'c-hammer');
  await t.queue.joinQueue({ accountId: 'alice', request: duel('c-sorc') });
  await t.queue.joinQueue({ accountId: 'bob', request: duel('c-hammer') });
  const checkId = t.bus.readyChecksStarted()[0]?.readyCheckId;
  if (checkId === undefined) {
    throw new Error('expected a ready check');
  }
  return checkId;
}

describe('the ready check: how long an ended check stays (RDY-06)', () => {
  it('keeps an ended check for ten minutes', () => {
    expect(ENDED_CHECK_KEEP_MS).toBe(10 * 60 * SECOND);
  });

  it('prunes, when a check opens, the ended checks older than ten minutes before that instant', async () => {
    const t = flowSetup();
    await openDuel(t);
    expect(t.checks.pruned).toStrictEqual([new Date(START.getTime() - 600 * SECOND)]);
  });
});

describe('the ready check: what settling leaves behind (RDY-03, RDY-04, RDY-05)', () => {
  it('cancels the pending deadline once every member accepted', async () => {
    const t = flowSetup();
    const checkId = await openDuel(t);
    expect(t.scheduler.cancelled).toBe(0);

    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    expect(t.scheduler.cancelled).toBe(0);
    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'accept' });

    expect(t.scheduler.cancelled).toBe(1);
  });

  it('leaves a check that was settled before its deadline alone when the deadline comes', async () => {
    const t = flowSetup({ ignoreCancel: true });
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'accept' });

    t.clock.advance(60 * SECOND);
    await t.queue.runMatcher();

    expect(t.bus.readyChecksResolved()).toHaveLength(1);
    expect(t.metrics.resolved).toStrictEqual(['accepted']);
    expect(t.outbox.appended.filter((event) => event.type === 'MatchFormed')).toHaveLength(1);
  });

  it('reports the waiting count of the pool when the accepted member goes back to the queue', async () => {
    const t = flowSetup();
    const checkId = await openDuel(t);
    await t.queue.answerReadyCheck({ accountId: 'alice', checkId, answer: 'accept' });
    expect(t.metrics.sizes.at(-1)?.size).toBe(0);

    await t.queue.answerReadyCheck({ accountId: 'bob', checkId, answer: 'decline' });

    expect(t.metrics.sizes.at(-1)?.size).toBe(1);
  });

  it('reports nothing to the queue when nobody goes back to it', async () => {
    const t = flowSetup();
    await openDuel(t);
    const sizesBefore = t.metrics.sizes.length;
    const updatesBefore = t.bus.queueUpdates().length;

    t.clock.advance(60 * SECOND);
    await t.queue.runMatcher();

    expect(t.bus.readyChecksResolved()[0]?.outcome).toBe('timed-out');
    expect(t.metrics.sizes).toHaveLength(sizesBefore);
    expect(t.bus.queueUpdates()).toHaveLength(updatesBefore);
    expect(await t.store.all()).toHaveLength(0);
  });
});
