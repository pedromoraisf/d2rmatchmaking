// The migrations of the platform outbox (OBS-05): 0002 adds the nullable `trace_context` column, and it goes back down.
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/support/postgres.ts';
import type { PlatformDatabase } from './database.ts';
import { migrateTo, migrateToLatest } from './migrator.ts';

let database: TestDatabase;
let db: Kysely<PlatformDatabase>;

beforeAll(async () => {
  database = await createTestDatabase();
  db = new Kysely<PlatformDatabase>({ dialect: new PostgresDialect({ pool: database.pool }) });
});

afterAll(async () => {
  await database.close();
});

/** The column's type and nullability, or undefined when the column does not exist. */
async function traceContextColumn(): Promise<{ data_type: string; is_nullable: string } | undefined> {
  const result = await database.pool.query<{ data_type: string; is_nullable: string }>(
    `select data_type, is_nullable from information_schema.columns
     where table_schema = 'platform' and table_name = 'outbox' and column_name = 'trace_context'`,
  );
  return result.rows[0];
}

describe('the outbox migrations', () => {
  it('migrates to 0002 and back', async () => {
    expect(await migrateToLatest(db)).toEqual([
      '0001_skeleton',
      '0002_outbox_trace_context',
      '0003_room_trace_context',
    ]);
    expect(await traceContextColumn()).toEqual({ data_type: 'text', is_nullable: 'YES' });

    await migrateTo(db, '0001_skeleton');
    expect(await traceContextColumn()).toBeUndefined();

    expect(await migrateToLatest(db)).toEqual(['0002_outbox_trace_context', '0003_room_trace_context']);
    expect(await traceContextColumn()).toEqual({ data_type: 'text', is_nullable: 'YES' });
  });
});
