// Production cannot serve the bots' identity (staging-bots SBT-03). The bots use only `POST /v1/auth/test-login` and the public
// player and agent routes, so the proof has two parts: with the staging endpoints off, the API answers 404 to the test
// sign-in and the staging match; and the routes that exist only with the endpoints on are exactly the two listed here, so
// a route added to the staging branch cannot reach production unnoticed.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

const SITE_ORIGIN = 'https://site.example';

/** The routes registered only when staging endpoints are on. A new one must be added here, deliberately (SBT-03). */
const STAGING_ONLY_ROUTES = ['POST /v1/auth/test-login', 'POST /v1/staging/match-formed'];

let database: MigratedTestDatabase<AppDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

async function appWith(stagingEndpoints: boolean): Promise<BuiltApp> {
  const clock = new FakeClock(new Date('2026-11-21T12:00:00.000Z'));
  return buildApp({
    db: database.db,
    config: { stagingEndpoints, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
}

/** The `METHOD path` lines of Fastify's route tree (the same reading as agent-token-reach.int.test.ts). */
function liveRoutes(tree: string): string[] {
  const segments: string[] = [];
  const found: string[] = [];
  for (const line of tree.split('\n')) {
    const node = /^((?:[│ ] {3})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/.exec(line);
    if (node === null) continue;
    segments.length = (node[1] ?? '').length / 4;
    segments.push(node[2] ?? '');
    for (const method of (node[3] ?? '').split(',').map((word) => word.trim())) {
      if (method === '' || method === 'HEAD' || method === 'OPTIONS') continue;
      found.push(`${method} ${segments.join('').replace(/:(\w+)/g, '{$1}')}`);
    }
  }
  return found.sort();
}

describe('the bots cannot exist on a production API (SBT-03)', () => {
  it('answers 404 to the test sign-in and the staging match when the staging endpoints are off', async () => {
    const production = await appWith(false);
    try {
      const login = await production.app.inject({
        method: 'POST',
        url: '/v1/auth/test-login',
        headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
        payload: { name: 'bot-k7-1' },
      });
      expect(login.statusCode).toBe(404);
      const match = await production.app.inject({
        method: 'POST',
        url: '/v1/staging/match-formed',
        headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
        payload: {},
      });
      expect(match.statusCode).toBe(404);
      const config = await production.app.inject({ method: 'GET', url: '/v1/config' });
      expect(config.json<{ stagingEndpoints: boolean }>().stagingEndpoints).toBe(false);
    } finally {
      await production.app.close();
    }
  });

  it('a queue join without a session is refused 401 there, so no anonymous bot can queue', async () => {
    const production = await appWith(false);
    try {
      const join = await production.app.inject({
        method: 'POST',
        url: '/v1/queue/tickets',
        headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
        payload: {
          mode: 'pvp',
          characterId: 'c-1',
          difficulty: 'hell',
          region: 'americas',
          format: 'duel',
          rules: 'gm',
        },
      });
      expect(join.statusCode).toBe(401);
    } finally {
      await production.app.close();
    }
  });

  it('the routes that exist only with the staging endpoints on are exactly the listed ones', async () => {
    const [staging, production] = [await appWith(true), await appWith(false)];
    try {
      const withEndpoints = liveRoutes(staging.app.printRoutes({ commonPrefix: false }));
      const without = new Set(liveRoutes(production.app.printRoutes({ commonPrefix: false })));
      const onlyStaging = withEndpoints.filter((route) => !without.has(route));
      expect(onlyStaging).toStrictEqual([...STAGING_ONLY_ROUTES].sort());
      // And nothing the other way: production has no route that staging lacks.
      expect([...without].filter((route) => !withEndpoints.includes(route))).toStrictEqual([]);
    } finally {
      await staging.app.close();
      await production.app.close();
    }
  });
});
