import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, type AnyDomainEvent } from '../../shared-kernel/index.ts';
import type { PlatformDatabase } from './database.ts';
import { PostgresOutbox } from './outbox.ts';
import { PostgresUnitOfWork } from './unit-of-work.ts';

class RecordingRelay {
  wakes = 0;

  wake(): void {
    this.wakes += 1;
  }
}

const CLOCK_START = new Date('2026-10-31T12:00:00.000Z');

const roomStageChanged: AnyDomainEvent = {
  type: 'RoomStageChanged',
  payload: { roomId: '11111111-1111-4111-8111-111111111111', stage: 'awaiting_host', members: [] },
};

let database: MigratedTestDatabase<PlatformDatabase>;
let relay: RecordingRelay;
let outbox: PostgresOutbox;
let uow: PostgresUnitOfWork<PlatformDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<PlatformDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('truncate platform.outbox restart identity');
  relay = new RecordingRelay();
  outbox = new PostgresOutbox(new FakeClock(CLOCK_START));
  uow = new PostgresUnitOfWork(database.db, outbox, relay);
});

async function outboxRows(): Promise<{ event_type: string; payload: unknown; created_at: Date }[]> {
  const result = await database.pool.query<{ event_type: string; payload: unknown; created_at: Date }>(
    'select event_type, payload, created_at from platform.outbox order by id',
  );
  return result.rows;
}

describe('PostgresOutbox and PostgresUnitOfWork', () => {
  it('appends one row in a committed transaction and wakes the relay once', async () => {
    await uow.run((tx) => outbox.append(tx, [roomStageChanged]));

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('RoomStageChanged');
    expect(rows[0]?.payload).toEqual(roomStageChanged.payload);
    expect(rows[0]?.created_at).toEqual(CLOCK_START);
    expect(relay.wakes).toBe(1);
  });

  it('rolls back the outbox row with the transaction', async () => {
    const failed = uow.run(async (tx) => {
      await outbox.append(tx, [roomStageChanged]);
      throw new Error('the change failed after the append');
    });

    await expect(failed).rejects.toThrow('the change failed after the append');
    expect(await outboxRows()).toEqual([]);
    expect(relay.wakes).toBe(0);
  });

  it('does not wake the relay for a commit without appends', async () => {
    const value = await uow.run(async () => 'no outbox rows');

    expect(value).toBe('no outbox rows');
    expect(relay.wakes).toBe(0);
  });

  it('refuses a transient event and stores nothing', async () => {
    const transient = uow.run((tx) =>
      outbox.append(tx, [{ type: 'AgentRevoked', payload: { agentId: 'a', accountId: 'b' } }]),
    );

    await expect(transient).rejects.toThrow('AgentRevoked is transient');
    expect(await outboxRows()).toEqual([]);
    expect(relay.wakes).toBe(0);
  });
});

describe('the trace context of an append', () => {
  it('append stores the traceparent of the active span in the transaction', async () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    try {
      const span = new BasicTracerProvider().getTracer('test').startSpan('test.append');
      const traceparent = `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`;

      await context.with(trace.setSpan(context.active(), span), () =>
        uow.run((tx) => outbox.append(tx, [roomStageChanged, roomStageChanged])),
      );
      span.end();
      await uow.run((tx) => outbox.append(tx, [roomStageChanged]));

      const result = await database.pool.query<{ trace_context: string | null }>(
        'select trace_context from platform.outbox order by id',
      );
      expect(result.rows.map((row) => row.trace_context)).toEqual([traceparent, traceparent, null]);
    } finally {
      context.disable();
    }
  });
});
