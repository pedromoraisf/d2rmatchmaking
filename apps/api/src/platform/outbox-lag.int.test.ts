// The outbox lag gauge (OBS-33): `outbox.lag` is the age in seconds of the oldest row the relay has neither published nor
// dead-lettered, read through the injected Clock, and 0 when no row waits. Read through an in-memory metric reader.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_METER_NAME, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../test/support/migrated-database.ts';
import { FakeClock } from '../shared-kernel/index.ts';
import type { PlatformDatabase } from './postgres/database.ts';
import { registerOutboxLag } from './outbox-lag.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const SECOND = 1_000;

let database: MigratedTestDatabase<PlatformDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<PlatformDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('truncate platform.outbox restart identity');
});

/** Inserts one outbox row and returns its id. */
async function insertRow(
  createdAt: Date,
  options: { publishedAt?: Date; failedAt?: Date } = {},
): Promise<string> {
  const result = await database.pool.query<{ id: string }>(
    `insert into platform.outbox (event_type, payload, created_at, published_at, failed_at)
     values ('RoomStageChanged', '{}', $1, $2, $3) returning id`,
    [createdAt, options.publishedAt ?? null, options.failedAt ?? null],
  );
  return result.rows[0]?.id ?? '';
}

/** `outbox.lag` as the reader exports it at the clock's current time. */
async function lagAt(clock: FakeClock): Promise<number> {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  registerOutboxLag(provider.getMeter(APP_METER_NAME), database.db, clock);
  try {
    await reader.forceFlush();
    const latest = exporter.getMetrics().at(-1);
    const metric = latest?.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === INSTRUMENT_NAMES.outboxLag);
    const points = metric?.dataPoints as DataPoint<number>[] | undefined;
    return points?.[0]?.value ?? Number.NaN;
  } finally {
    await provider.shutdown();
  }
}

describe('outbox.lag', () => {
  it('outbox.lag is the age of the oldest unpublished row and 0 when none', async () => {
    const clock = new FakeClock(new Date(START.getTime() + 90 * SECOND));
    // A dead-lettered row is not waiting for the relay, so it does not count, however old it is.
    await insertRow(new Date(START.getTime() - 3_600 * SECOND), { failedAt: START });
    const oldest = await insertRow(START);
    await insertRow(new Date(START.getTime() + 60 * SECOND));
    expect(await lagAt(clock)).toBe(90);

    await database.pool.query('update platform.outbox set published_at = $1 where id = $2', [START, oldest]);
    expect(await lagAt(clock)).toBe(30);

    await database.pool.query('update platform.outbox set published_at = $1', [START]);
    expect(await lagAt(clock)).toBe(0);
  });
});
