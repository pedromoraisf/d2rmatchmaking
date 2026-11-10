import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import * as skeleton from '../../../migrations/0001_skeleton.ts';
import * as outboxTraceContext from '../../../migrations/0002_outbox_trace_context.ts';
import * as roomTraceContext from '../../../migrations/0003_room_trace_context.ts';
import * as accountBnetSub from '../../../migrations/0004_account_bnet_sub.ts';

/**
 * Every migration of the API, by name. Kysely applies them in name order. The list lives here, not in `main/`, so the
 * module integration tests can migrate their databases without importing the composition root (nobody-imports-main).
 */
const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001_skeleton': skeleton,
  '0002_outbox_trace_context': outboxTraceContext,
  '0003_room_trace_context': roomTraceContext,
  '0004_account_bnet_sub': accountBnetSub,
};

const provider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};

/**
 * Moves the database to `migration`, up or down, and returns the names this call applied or reverted. Used by the
 * migration tests to step back; the application only ever migrates to the latest.
 */
export async function migrateTo<DB>(db: Kysely<DB>, migration: string): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateTo(migration);
  if (error !== undefined) {
    throw error;
  }
  return (results ?? [])
    .filter((result) => result.status === 'Success')
    .map((result) => result.migrationName);
}

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
