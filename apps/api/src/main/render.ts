// The Render composition root (design.md § Composition roots, AWS-31): Neon over TLS, binds 0.0.0.0:$PORT, and fails
// closed. It refuses to start when staging endpoints are on outside staging, and when D2RMM_ACCEPTANCE is set at all
// (AD-045). It never imports test-controls.ts: the Render app has no /__test route.
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { buildApp, type AppDatabase } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { ClockScheduler, NodeRandomSource, RandomUuidGenerator, SystemClock } from './runtime.ts';
import { shutdownTelemetry } from './telemetry-lifecycle.ts';

/** Every reason this process must not start, or undefined when the configuration is acceptable. */
export function refusalOf(config: Config): string | undefined {
  if (config.acceptanceSet) {
    return 'D2RMM_ACCEPTANCE is set: the test controls never run on Render';
  }
  if (config.stagingEndpoints && config.environment !== 'staging') {
    return 'ENABLE_STAGING_ENDPOINTS=true needs D2RMM_ENV=staging';
  }
  if (config.databaseUrl === undefined) {
    return 'DATABASE_URL is required';
  }
  return undefined;
}

/** Starts the Render API. Exits non-zero, before any connection, when the configuration is refused. */
async function main(): Promise<void> {
  const config = loadConfig();
  const refusal = refusalOf(config);
  if (refusal !== undefined) {
    process.stderr.write(`render: refusing to start: ${refusal}\n`);
    process.exit(1);
  }
  const databaseUrl = config.databaseUrl;
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required');
  }
  // Neon accepts TLS connections only; the certificate is verified, never skipped.
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true } });
  const db = new Kysely<AppDatabase>({ dialect: new PostgresDialect({ pool }) });
  const clock = new SystemClock();
  const built = await buildApp({
    db,
    config: {
      stagingEndpoints: config.stagingEndpoints,
      minAgentVersion: config.agentMinVersion,
      siteOrigin: config.siteOrigin,
      trustProxyHops: config.trustProxyHops,
      roomDropToleranceSeconds: config.roomDropToleranceSeconds,
      bnet: config.bnet,
    },
    clock,
    scheduler: new ClockScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    telemetryBackend: { endpoint: config.telemetry.endpoint, headers: config.telemetry.headers },
  });
  const address = await built.app.listen({ host: '0.0.0.0', port: config.port });
  await built.relay.sweep();
  process.stdout.write(`d2rmm render api listening on ${address}\n`);
  const stop = (): void => {
    void built.app
      .close()
      .then(() => db.destroy())
      .then(() => shutdownTelemetry())
      .then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
