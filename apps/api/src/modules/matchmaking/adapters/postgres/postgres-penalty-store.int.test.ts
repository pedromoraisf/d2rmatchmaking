import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import { PostgresPenaltyStore } from './postgres-penalty-store.ts';
import type { MatchmakingDatabase } from './schema.ts';

const UNTIL = new Date('2026-11-10T12:05:00.000Z');

let database: MigratedTestDatabase<MatchmakingDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<MatchmakingDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('delete from matchmaking.penalties');
});

describe('PostgresPenaltyStore (RDY-05, RDY-09)', () => {
  it('answers undefined for an account with no penalty', async () => {
    const store = new PostgresPenaltyStore(database.db);
    expect(await store.untilOf(randomUUID())).toBeUndefined();
  });

  it('keeps the instant each account’s penalty ends', async () => {
    const store = new PostgresPenaltyStore(database.db);
    const alice = randomUUID();
    const bob = randomUUID();
    await store.record([alice, bob], UNTIL, 'ready-check-timeout');

    expect(await store.untilOf(alice)).toStrictEqual(UNTIL);
    expect(await store.untilOf(bob)).toStrictEqual(UNTIL);
  });

  it('replaces the penalty of an account that is penalised again', async () => {
    const store = new PostgresPenaltyStore(database.db);
    const alice = randomUUID();
    await store.record([alice], UNTIL, 'ready-check-timeout');
    const later = new Date(UNTIL.getTime() + 60_000);
    await store.record([alice], later, 'ready-check-timeout');

    expect(await store.untilOf(alice)).toStrictEqual(later);
    const rows = await database.pool.query('select count(*)::int as count from matchmaking.penalties');
    expect(rows.rows[0]).toStrictEqual({ count: 1 });
  });

  it('keeps a penalty across an API restart: a new pool and a new store read the same row (RDY-09)', async () => {
    const alice = randomUUID();
    await new PostgresPenaltyStore(database.db).record([alice], UNTIL, 'ready-check-timeout');

    // A restart is a new process with its own pool on the same database.
    const restarted = new Kysely<MatchmakingDatabase>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: database.url }) }),
    });
    try {
      expect(await new PostgresPenaltyStore(restarted).untilOf(alice)).toStrictEqual(UNTIL);
    } finally {
      await restarted.destroy();
    }
  });

  it('records nothing for an empty list of accounts', async () => {
    const store = new PostgresPenaltyStore(database.db);
    await store.record([], UNTIL, 'ready-check-timeout');
    const rows = await database.pool.query('select count(*)::int as count from matchmaking.penalties');
    expect(rows.rows[0]).toStrictEqual({ count: 0 });
  });
});
