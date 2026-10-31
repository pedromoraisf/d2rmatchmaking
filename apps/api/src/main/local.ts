// The local composition root (design.md § Composition roots, AWS-31): Postgres from DATABASE_URL, migrations on start,
// bound to 127.0.0.1 only. With D2RMM_ACCEPTANCE=true it runs on a controllable clock and registers the test controls.
// `node src/main/local.ts` runs it; tests start it as a child process.
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { migrateToLatest } from '../platform/postgres/migrator.ts';
import { buildApp, type AppDatabase } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { ClockScheduler, NodeRandomSource, RandomUuidGenerator, SystemClock } from './runtime.ts';
import { ControllableClock, registerTestControls } from './test-controls.ts';
import type { Clock } from '../shared-kernel/index.ts';

/** The loopback bind of the local root: never configurable, never the network (AD-045). */
const LOCAL_HOST = '127.0.0.1';

export interface LocalServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Starts the local API on loopback and returns its address. The caller owns `close()`. */
export async function startLocal(config: Config): Promise<LocalServer> {
  if (config.databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required');
  }
  if (config.acceptance && config.testControlSecret === undefined) {
    throw new Error('TEST_CONTROL_SECRET is required when D2RMM_ACCEPTANCE=true');
  }
  const databaseUrl = new URL(config.databaseUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const db = new Kysely<AppDatabase>({ dialect: new PostgresDialect({ pool }) });
  try {
    await migrateToLatest(db);
    const controllable = config.acceptance ? new ControllableClock(new Date()) : undefined;
    const clock: Clock = controllable ?? new SystemClock();
    const built = await buildApp({
      db,
      config: {
        stagingEndpoints: config.stagingEndpoints,
        minAgentVersion: config.agentMinVersion,
        siteOrigin: config.siteOrigin,
        trustProxyHops: config.trustProxyHops,
      },
      clock,
      scheduler: new ClockScheduler(clock),
      random: new NodeRandomSource(),
      ids: new RandomUuidGenerator(),
    });
    if (controllable !== undefined && config.testControlSecret !== undefined) {
      registerTestControls(built.app, {
        db,
        clock: controllable,
        secret: config.testControlSecret,
        database: { name: databaseUrl.pathname.replace(/^\//, ''), host: databaseUrl.hostname },
        stores: built.stores,
        hub: built.hub,
        relay: built.relay,
      });
    }
    const address = await built.app.listen({ host: LOCAL_HOST, port: config.port });
    await built.relay.sweep();
    return {
      url: address,
      close: async () => {
        await built.app.close();
        await db.destroy();
      },
    };
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startLocal(loadConfig());
  process.stdout.write(`d2rmm local api listening on ${server.url}\n`);
  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
