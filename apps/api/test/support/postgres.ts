// Postgres for the integration tests (Testcontainers, ADR 014). The default export is Vitest's global setup: it starts
// one container per run and provides its admin URL. Tests call createTestDatabase() once per test file to get a fresh
// database on that container.
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { inject } from 'vitest';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresAdminUrl: string;
  }
}

export interface TestDatabase {
  /** The database name, unique to this call. */
  readonly name: string;
  /** A connection string to this database. */
  readonly url: string;
  readonly pool: pg.Pool;
  /** Ends the pool. The database itself is dropped with the container at the end of the run. */
  close(): Promise<void>;
}

export default async function startPostgres(project: TestProject): Promise<() => Promise<void>> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine').start();
  project.provide('postgresAdminUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}

/** Creates an empty database on the run's container and returns a pool connected to it. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('postgresAdminUrl');
  const name = `it_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const database = new URL(adminUrl);
  database.pathname = `/${name}`;
  const url = database.toString();
  const pool = new pg.Pool({ connectionString: url });
  return {
    name,
    url,
    pool,
    close: () => pool.end(),
  };
}
