import { afterAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './postgres.ts';

const opened: TestDatabase[] = [];

afterAll(async () => {
  await Promise.all(opened.map((database) => database.close()));
});

describe('createTestDatabase', () => {
  it('gives two calls distinct databases that both answer select 1', async () => {
    const first = await createTestDatabase();
    const second = await createTestDatabase();
    opened.push(first, second);

    expect(first.name).not.toBe(second.name);
    expect(first.url).not.toBe(second.url);
    expect((await first.pool.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
    expect((await second.pool.query('select 1 as one')).rows).toEqual([{ one: 1 }]);
  });

  it('connects to the database named in its URL', async () => {
    const database = await createTestDatabase();
    opened.push(database);

    const result = await database.pool.query('select current_database() as name');

    expect(result.rows).toEqual([{ name: database.name }]);
  });
});
