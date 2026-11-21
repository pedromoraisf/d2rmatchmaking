// AGT-01 (NFR-06, ADR 011): an agent token opens only the agent's routes, and a session cookie alone opens none of
// them. The route table is checked against the committed OpenAPI document, so a new route must be classified.
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { OPENAPI_PATH } from '../openapi.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';
import { ROUTE_REACH, agentRoutes } from './agent-route-table.ts';
import { SITE_ORIGIN, send, sessionFor, tokenFor } from './agent-reach-helpers.ts';

let database: MigratedTestDatabase<AppDatabase>;
let app: BuiltApp;

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const clock = new FakeClock(new Date('2026-10-31T12:00:00.000Z'));
  app = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
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
});

afterEach(async () => {
  await app.app.close();
});

/**
 * The `METHOD path` lines of Fastify's route tree. The tree shares prefixes (`/v1/agents/pair` then `ing-codes` under it),
 * so each node's path is the segments of its ancestors followed by its own. Four characters of the line's drawing are one
 * level of depth. HEAD and OPTIONS (added by Fastify for a GET) are left out; `:id` is written `{id}` as the table does.
 */
export function liveRoutes(tree: string): string[] {
  const segments: string[] = [];
  const found: string[] = [];
  for (const line of tree.split('\n')) {
    const node = /^((?:[│ ] {3})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/.exec(line);
    if (node === null) continue;
    const depth = (node[1] ?? '').length / 4;
    segments.length = depth;
    segments.push(node[2] ?? '');
    for (const method of (node[3] ?? '').split(',').map((word) => word.trim())) {
      if (method === '' || method === 'HEAD' || method === 'OPTIONS') continue;
      found.push(`${method} ${segments.join('').replace(/:(\w+)/g, '{$1}')}`);
    }
  }
  return found.sort();
}

/** The stream stays open once it is accepted, so the live call is left to the stream tests (IDB-08, site-stream-close). */
const OPENS_A_STREAM = '/v1/stream';

describe('the agent token reaches only the agent routes (AGT-01)', () => {
  it('classifies every operation of openapi.json, and only those', () => {
    const document = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented = Object.entries(document.paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`))
      .sort();
    const classified = ROUTE_REACH.map((route) => `${route.method} ${route.path}`).sort();
    expect(classified).toEqual(documented);
  });

  it('classifies every route the live router holds, hidden from the document or not', () => {
    // `printRoutes` lists what Fastify routes, including a route with `schema.hide`, which the document leaves out.
    const live = liveRoutes(app.app.printRoutes({ commonPrefix: false }));
    const classified = ROUTE_REACH.map((route) => `${route.method} ${route.path}`).sort();
    expect(live).toEqual(classified);
  });

  it('keeps the agent token reach to the nine routes of the spec', () => {
    expect(
      agentRoutes()
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    ).toEqual(
      [
        'GET /v1/agents/config',
        'GET /v1/agents/me/assignment',
        'GET /v1/ready-checks/me',
        'GET /v1/stream',
        'POST /v1/agents/heartbeat',
        'POST /v1/lobby-rooms/{id}/observations',
        'POST /v1/me/characters',
        'POST /v1/ready-checks/{id}/accept',
        'POST /v1/telemetry/traces',
      ].sort(),
    );
  });

  it('answers 401 to an agent token on every route that takes a session', async () => {
    const token = await tokenFor(app, await sessionFor(app));
    const statuses: string[] = [];
    for (const route of ROUTE_REACH.filter((candidate) => candidate.reach === 'session')) {
      const response = await send(app, route, { authorization: `Bearer ${token}` });
      statuses.push(`${route.method} ${route.path} ${response.statusCode}`);
    }
    expect(statuses.filter((line) => !line.endsWith(' 401'))).toEqual([]);
  });

  it('answers 401 to a session cookie alone on every route that takes an agent token alone', async () => {
    const cookie = await sessionFor(app);
    await tokenFor(app, cookie);
    const statuses: string[] = [];
    for (const route of ROUTE_REACH.filter((candidate) => candidate.reach === 'agent')) {
      const response = await send(app, route, { cookie });
      statuses.push(`${route.method} ${route.path} ${response.statusCode}`);
    }
    expect(statuses.filter((line) => !line.endsWith(' 401'))).toEqual([]);
  });

  it('accepts the agent token on every agent route (the guard lets it through)', async () => {
    const token = await tokenFor(app, await sessionFor(app));
    for (const route of agentRoutes().filter((candidate) => candidate.path !== OPENS_A_STREAM)) {
      const response = await send(app, route, { authorization: `Bearer ${token}` });
      expect(response.statusCode, `${route.method} ${route.path}`).not.toBe(401);
    }
  });
});
