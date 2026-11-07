import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/support/postgres.ts';
import { migrateDatabase } from '../migrate.ts';

let database: TestDatabase;
let firstRun: string[];

beforeAll(async () => {
  database = await createTestDatabase();
  firstRun = await migrateDatabase(database.url);
});

afterAll(async () => {
  await database.close();
});

describe('migrate', () => {
  it('first run applies 0001_skeleton and creates the four schemas', async () => {
    expect(firstRun).toEqual(['0001_skeleton', '0002_outbox_trace_context', '0003_room_trace_context']);

    const result = await database.pool.query<{ schema_name: string }>(
      `select schema_name from information_schema.schemata
       where schema_name in ('identity', 'agents', 'lobby', 'platform') order by schema_name`,
    );

    expect(result.rows.map((row) => row.schema_name)).toEqual(['agents', 'identity', 'lobby', 'platform']);
  });

  it('second run applies none', async () => {
    const secondRun = await migrateDatabase(database.url);

    expect(secondRun).toEqual([]);
  });

  it('rejects a second unused pairing code with the same digits', async () => {
    const first = randomUUID();
    const second = randomUUID();
    await database.pool.query(
      `insert into agents.agents (id, claim_secret_hash, created_at) values ($1, 'claim-a', now()), ($2, 'claim-b', now())`,
      [first, second],
    );
    await database.pool.query(
      `insert into agents.pairing_codes (agent_id, code, expires_at) values ($1, '123456', now() + interval '5 minutes')`,
      [first],
    );

    const duplicate = database.pool.query(
      `insert into agents.pairing_codes (agent_id, code, expires_at) values ($1, '123456', now() + interval '5 minutes')`,
      [second],
    );

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });
});
