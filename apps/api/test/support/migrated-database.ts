// A fresh database on the run's Postgres container, migrated to the latest schema, with a Kysely instance on it. Module
// integration tests use it; the module code under test never imports this file.
import { Kysely, PostgresDialect } from 'kysely';
import { migrateToLatest } from '../../src/platform/postgres/migrator.ts';
import { createTestDatabase, type TestDatabase } from './postgres.ts';

export interface MigratedTestDatabase<DB> extends TestDatabase {
  /** Kysely on this database. `close()` ends the pool it uses. */
  readonly db: Kysely<DB>;
}

export async function createMigratedTestDatabase<DB>(): Promise<MigratedTestDatabase<DB>> {
  const database = await createTestDatabase();
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: database.pool }) });
  await migrateToLatest(db);
  return { ...database, db };
}
