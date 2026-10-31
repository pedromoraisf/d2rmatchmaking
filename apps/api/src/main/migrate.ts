// `pnpm --filter @d2rmm/api db:migrate`: applies the pending migrations to DATABASE_URL and exits. The database URL is
// read through main/config.ts, the only reader of the environment (AWS-31).
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { migrateToLatest } from '../platform/postgres/migrator.ts';
import { loadConfig } from './config.ts';

/** Applies the pending migrations to the database at `databaseUrl`. Returns the names this run applied. */
export async function migrateDatabase(databaseUrl: string): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    return await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const databaseUrl = loadConfig().databaseUrl;
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const applied = await migrateDatabase(databaseUrl);
  process.stdout.write(
    applied.length === 0 ? 'Database is up to date.\n' : `Applied: ${applied.join(', ')}.\n`,
  );
  process.exit(0);
}
