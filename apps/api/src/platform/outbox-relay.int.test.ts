import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler, type AnyDomainEvent, type BusEvent } from '../shared-kernel/index.ts';
import type { PlatformDatabase } from './postgres/database.ts';
import { PostgresOutbox } from './postgres/outbox.ts';
import { PostgresUnitOfWork } from './postgres/unit-of-work.ts';
import { InMemoryEventBus } from './event-bus.ts';
import { OutboxRelay } from './outbox-relay.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const POISON = '99999999-9999-4999-8999-999999999999';

let database: MigratedTestDatabase<PlatformDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<PlatformDatabase>();
});

afterAll(async () => {
  await database.close();
});

/** A relay whose wake does nothing, so rows can be committed while no relay runs. */
const silentRelay = { wake: (): void => undefined };
const silentLog = { error: (): void => undefined };

function stageChanged(roomId: string): AnyDomainEvent {
  return { type: 'RoomStageChanged', payload: { roomId, stage: 'awaiting_host', members: [] } };
}

/** Commits one outbox row per event, in order, while no relay is running. */
async function commitRows(events: readonly AnyDomainEvent[]): Promise<void> {
  const outbox = new PostgresOutbox(new FakeClock(START));
  const uow = new PostgresUnitOfWork(database.db, outbox, silentRelay);
  for (const event of events) {
    await uow.run((tx) => outbox.append(tx, [event]));
  }
}

interface Row {
  readonly id: string;
  readonly attempts: number;
  readonly published: boolean;
  readonly dead: boolean;
}

async function rows(): Promise<Row[]> {
  const result = await database.pool.query<{
    id: string;
    attempts: number;
    published_at: Date | null;
    failed_at: Date | null;
  }>('select id, attempts, published_at, failed_at from platform.outbox order by id');
  return result.rows.map((row) => ({
    id: row.id,
    attempts: row.attempts,
    published: row.published_at !== null,
    dead: row.failed_at !== null,
  }));
}

/** A bus that records each durable event it delivers, in order, and fails for the poison room. */
function recordingBus(): { bus: InMemoryEventBus; delivered: string[]; attempts: { count: number } } {
  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const attempts = { count: 0 };
  bus.subscribe('RoomStageChanged', (event: BusEvent) => {
    if (event.kind !== 'durable' || event.event.type !== 'RoomStageChanged') {
      return;
    }
    const roomId = event.event.payload.roomId;
    if (roomId === POISON) {
      attempts.count += 1;
      throw new Error('the poison handler always fails');
    }
    delivered.push(roomId);
  });
  return { bus, delivered, attempts };
}

beforeEach(async () => {
  await database.pool.query('truncate platform.outbox restart identity');
});

describe('OutboxRelay', () => {
  it('publishes rows left unpublished before a restart', async () => {
    await commitRows([
      stageChanged('11111111-1111-4111-8111-111111111111'),
      stageChanged('22222222-2222-4222-8222-222222222222'),
    ]);
    const clock = new FakeClock(START);
    const { bus, delivered } = recordingBus();
    const restarted = new OutboxRelay({
      db: database.db,
      bus,
      scheduler: new FakeScheduler(clock),
      clock,
      log: silentLog,
    });

    await restarted.sweep();

    expect(delivered).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect((await rows()).every((row) => row.published)).toBe(true);
  });

  it('publishes rows in id order', async () => {
    const ids = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    await commitRows(ids.map(stageChanged));
    const clock = new FakeClock(START);
    const { bus, delivered } = recordingBus();

    await new OutboxRelay({
      db: database.db,
      bus,
      scheduler: new FakeScheduler(clock),
      clock,
      log: silentLog,
    }).sweep();

    expect(delivered).toEqual(ids);
  });

  it('retry delays are 1, 2, 4 and 8 seconds', async () => {
    await commitRows([stageChanged(POISON)]);
    const clock = new FakeClock(START);
    const { bus, attempts } = recordingBus();
    const relay = new OutboxRelay({
      db: database.db,
      bus,
      scheduler: new FakeScheduler(clock),
      clock,
      log: silentLog,
    });
    const elapse = async (ms: number): Promise<void> => {
      clock.advance(ms);
      await relay.settled();
    };

    await relay.sweep();
    expect(attempts.count).toBe(1);

    await elapse(999);
    expect(attempts.count).toBe(1);
    await elapse(1);
    expect(attempts.count).toBe(2);

    await elapse(1_999);
    expect(attempts.count).toBe(2);
    await elapse(1);
    expect(attempts.count).toBe(3);

    await elapse(3_999);
    expect(attempts.count).toBe(3);
    await elapse(1);
    expect(attempts.count).toBe(4);

    await elapse(7_999);
    expect(attempts.count).toBe(4);
    await elapse(1);
    expect(attempts.count).toBe(5);
  });

  it('dead-letters after 5 failures and keeps going', async () => {
    await commitRows([stageChanged(POISON), stageChanged('66666666-6666-4666-8666-666666666666')]);
    const clock = new FakeClock(START);
    const { bus, delivered } = recordingBus();
    const relay = new OutboxRelay({
      db: database.db,
      bus,
      scheduler: new FakeScheduler(clock),
      clock,
      log: silentLog,
    });

    await relay.sweep();
    for (const ms of [1_000, 2_000, 4_000, 8_000]) {
      clock.advance(ms);
      await relay.settled();
    }

    const [poison, next] = await rows();
    expect(poison).toMatchObject({ attempts: 5, dead: true, published: false });
    expect(next).toMatchObject({ published: true, dead: false });
    expect(delivered).toEqual(['66666666-6666-4666-8666-666666666666']);

    await commitRows([stageChanged('77777777-7777-4777-8777-777777777777')]);
    await relay.wake();
    expect(delivered).toEqual([
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
    ]);
  });
});
