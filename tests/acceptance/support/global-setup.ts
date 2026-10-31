// Runs once per acceptance run (design.md § Acceptance stack): one Postgres container for every worker. Each worker
// creates its own database on it (`acc_w<n>`, support/stack.ts). The container is stopped when the run ends.
import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** The environment variable through which workers learn the container's admin connection string. */
export const POSTGRES_URL_ENV = 'ACCEPTANCE_POSTGRES_URL';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  // Workers are forked after globalSetup returns, so they inherit this variable.
  process.env[POSTGRES_URL_ENV] = container.getConnectionUri();
  return async () => {
    await container.stop();
  };
}
