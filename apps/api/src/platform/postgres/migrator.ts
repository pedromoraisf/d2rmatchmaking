import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import * as skeleton from '../../../migrations/0001_skeleton.ts';

/**
 * Every migration of the API, by name. Kysely applies them in name order. The list lives here, not in `main/`, so the
 * module integration tests can migrate their databases without importing the composition root (nobody-imports-main).
 */
const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001_skeleton': skeleton,
};

const provider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};

/**
 * Applies every pending migration and returns the names this call applied: an empty list when the database is up to
 * date. A failing migration rejects with its error; Kysely rolls back that migration.
 */
export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  if (error !== undefined) {
    throw error;
  }
  return (results ?? [])
    .filter((result) => result.status === 'Success')
    .map((result) => result.migrationName);
}
