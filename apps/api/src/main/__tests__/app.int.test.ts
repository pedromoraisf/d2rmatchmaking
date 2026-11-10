import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { MemoryAgentTokenCache } from '../../modules/agents/adapters/memory/memory-agent-token-cache.ts';
import { MemoryPresenceStore } from '../../modules/agents/adapters/memory/memory-presence-store.ts';
import { MemoryRateLimitStore } from '../../modules/agents/adapters/memory/memory-rate-limit-store.ts';
import {
  FakeClock,
  FakeScheduler,
  SequentialIdGenerator,
  SeededRandomSource,
} from '../../shared-kernel/index.ts';
import { buildApp, type AppConfig, type AppDatabase, type BuiltApp } from '../app.ts';

const START = new Date('2026-10-31T12:00:00.000Z');

const CONFIG: AppConfig = {
  stagingEndpoints: true,
  minAgentVersion: '0.0.1',
  siteOrigin: 'https://site.example',
  trustProxyHops: 1,
};

/** A log sink that keeps nothing: the tests that read logs use their own. */
const silentSink = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

const opened: MigratedTestDatabase<AppDatabase>[] = [];
const built: BuiltApp[] = [];

afterEach(async () => {
  for (const app of built.splice(0)) {
    await app.app.close();
  }
  for (const database of opened.splice(0)) {
    await database.close().catch(() => undefined);
  }
});

async function startApp(config: AppConfig = CONFIG): Promise<{
  app: BuiltApp;
  database: MigratedTestDatabase<AppDatabase>;
}> {
  const database = await createMigratedTestDatabase<AppDatabase>();
  opened.push(database);
  const clock = new FakeClock(START);
  const app = await buildApp({
    db: database.db,
    config,
    clock,
    scheduler: new FakeScheduler(clock),
    random: new SeededRandomSource(1),
    ids: new SequentialIdGenerator('id'),
    logSink: silentSink,
  });
  built.push(app);
  return { app, database };
}

describe('buildApp', () => {
  it('healthz answers with the database down', async () => {
    const { app, database } = await startApp();
    await database.close();

    const response = await app.app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('/v1/config reflects the staging flag and the minimum agent version', async () => {
    const { app } = await startApp({ ...CONFIG, stagingEndpoints: false, minAgentVersion: '1.2.3' });

    const response = await app.app.inject({ method: 'GET', url: '/v1/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ stagingEndpoints: false, minAgentVersion: '1.2.3', bnetSignIn: false });
  });

  it('with stagingEndpoints false the test-login and match-formed routes answer 404', async () => {
    const { app } = await startApp({ ...CONFIG, stagingEndpoints: false });

    const login = await app.app.inject({
      method: 'POST',
      url: '/v1/auth/test-login',
      payload: { name: 'PlayerOne' },
    });
    const match = await app.app.inject({ method: 'POST', url: '/v1/staging/match-formed', payload: {} });

    expect(login.statusCode).toBe(404);
    expect(match.statusCode).toBe(404);
  });

  it('a validation error lists field paths and not values', async () => {
    const { app } = await startApp();
    const typed = app.app.withTypeProvider<ZodTypeProvider>();
    typed.post('/probe/body', { schema: { body: z.object({ name: z.string().min(2) }) } }, () => ({
      ok: true,
    }));

    const response = await app.app.inject({
      method: 'POST',
      url: '/probe/body',
      payload: { name: 4242424242 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-request', fields: ['name'] });
    expect(response.body).not.toContain('4242424242');
  });

  it('runs with no external broker', async () => {
    const { app } = await startApp();
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    const brokers = Object.keys(pkg.dependencies ?? {}).filter((name) =>
      /redis|bull|amqp|rabbit|kafka|nats|sqs|pubsub/i.test(name),
    );
    expect(brokers).toEqual([]);
    expect(app.stores.presence).toBeInstanceOf(MemoryPresenceStore);
    expect(app.stores.rateLimits).toBeInstanceOf(MemoryRateLimitStore);
    expect(app.stores.tokenCache).toBeInstanceOf(MemoryAgentTokenCache);
  });

  it('answers 503 unavailable when a route cannot reach the database', async () => {
    const { app, database } = await startApp();
    app.app.withTypeProvider<ZodTypeProvider>().get('/probe/db', async () => {
      await database.db.selectFrom('platform.outbox').select('id').limit(1).execute();
      return { ok: true };
    });
    await database.close();

    const response = await app.app.inject({ method: 'GET', url: '/probe/db' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'unavailable' });
  });
});
