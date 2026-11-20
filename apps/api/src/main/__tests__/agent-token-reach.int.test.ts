// AGT-01 (NFR-06, ADR 011): an agent token opens only the agent's routes, and a session cookie alone opens none of
// them. The route table is checked against the committed OpenAPI document, so a new route must be classified.
import { randomUUID } from 'node:crypto';
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
import { ROUTE_REACH, agentRoutes, bodyFor, urlOf, type RouteReach } from './agent-route-table.ts';

const SITE_ORIGIN = 'https://site.example';
const AGENT_VERSION = '1.0.0';

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

function bodyOf<T>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

async function sessionFor(): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name: `p${randomUUID().replaceAll('-', '').slice(0, 14)}` },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? (header[0] ?? '') : String(header ?? '')).split(';')[0] ?? '';
}

/** Pairs an agent for the session and returns its token. */
async function tokenFor(cookie: string): Promise<string> {
  const headers = { 'x-agent-version': AGENT_VERSION };
  const issued = bodyOf<{ code: string; claimSecret: string }>(
    await app.app.inject({ method: 'POST', url: '/v1/agents/pairing-codes', headers }),
  );
  const claim = (): ReturnType<typeof app.app.inject> =>
    app.app.inject({
      method: 'POST',
      url: '/v1/agents/pairing-codes/claim',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { claimSecret: issued.claimSecret },
    });
  await claim();
  const paired = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: { code: issued.code },
  });
  expect(paired.statusCode).toBe(200);
  return bodyOf<{ token: string }>(await claim()).token;
}

/** One request to a route with the given credential headers. A body is sent where the route takes one. */
function send(route: RouteReach, credential: Record<string, string>) {
  return app.app.inject({
    method: route.method,
    url: urlOf(route),
    headers: {
      'x-agent-version': AGENT_VERSION,
      origin: SITE_ORIGIN,
      'content-type': 'application/json',
      ...credential,
    },
    ...(route.method === 'GET' ? {} : { payload: bodyFor(route) as object }),
  });
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

  it('keeps the agent token reach to the eight routes of the spec', () => {
    expect(
      agentRoutes()
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    ).toEqual(
      [
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
    const token = await tokenFor(await sessionFor());
    const statuses: string[] = [];
    for (const route of ROUTE_REACH.filter((candidate) => candidate.reach === 'session')) {
      const response = await send(route, { authorization: `Bearer ${token}` });
      statuses.push(`${route.method} ${route.path} ${response.statusCode}`);
    }
    expect(statuses.filter((line) => !line.endsWith(' 401'))).toEqual([]);
  });

  it('answers 401 to a session cookie alone on every route that takes an agent token alone', async () => {
    const cookie = await sessionFor();
    await tokenFor(cookie);
    const statuses: string[] = [];
    for (const route of ROUTE_REACH.filter((candidate) => candidate.reach === 'agent')) {
      const response = await send(route, { cookie });
      statuses.push(`${route.method} ${route.path} ${response.statusCode}`);
    }
    expect(statuses.filter((line) => !line.endsWith(' 401'))).toEqual([]);
  });

  it('accepts the agent token on every agent route (the guard lets it through)', async () => {
    const token = await tokenFor(await sessionFor());
    for (const route of agentRoutes().filter((candidate) => candidate.path !== OPENS_A_STREAM)) {
      const response = await send(route, { authorization: `Bearer ${token}` });
      expect(response.statusCode, `${route.method} ${route.path}`).not.toBe(401);
    }
  });
});
