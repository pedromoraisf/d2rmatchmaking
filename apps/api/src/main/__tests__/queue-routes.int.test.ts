// The queue routes against the migrated database (design.md § Matchmaking module, adapters). A player signed in by the
// test sign-in has no agent online, so a join is refused with agent-offline: the entry checks before it are the ones that
// matter here. The full path (agent, site stream, match) is the acceptance suite's (T6).
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

const START = new Date('2026-11-10T12:00:00.000Z');
const SITE_ORIGIN = 'https://site.example';

let database: MigratedTestDatabase<AppDatabase>;
let clock: FakeClock;
let app: BuiltApp;

const silentSink = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  clock = new FakeClock(START);
  app = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: silentSink,
  });
});

afterEach(async () => {
  await app.app.close();
});

/** A test sign-in from the site's origin, as the browser sends it. */
async function signedInCookie(name: string): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name },
  });
  const header = response.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

const pvpJoin = {
  mode: 'pvp',
  characterId: '5f0c2c1e-0000-4000-8000-000000000001',
  difficulty: 'hell',
  region: 'americas',
  format: 'duel',
  rules: 'gm',
};

function join(cookie: string | undefined, payload: unknown, origin = SITE_ORIGIN) {
  return app.app.inject({
    method: 'POST',
    url: '/v1/queue/tickets',
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      origin,
      'content-type': 'application/json',
    },
    payload: payload as Record<string, unknown>,
  });
}

describe('queue routes', () => {
  it('answers 401 to a join with no session, and stores nothing', async () => {
    const response = await join(undefined, pvpJoin);
    expect(response.statusCode).toBe(401);
  });

  it('answers 403 to a join from another origin, even with a session', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await join(cookie, pvpJoin, 'https://evil.example');
    expect(response.statusCode).toBe(403);
  });

  it('answers 400 to a join whose mode is unknown', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await join(cookie, { ...pvpJoin, mode: 'raid' });
    expect(response.statusCode).toBe(400);
  });

  it('answers 422 agent-offline to a join by a signed-in player with no agent online (QUE-05)', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await join(cookie, pvpJoin);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toStrictEqual({ error: 'agent-offline' });
  });

  it('answers 429 too-many-joins to the eleventh join in a minute, and stores nothing (QUE-18)', async () => {
    const cookie = await signedInCookie('Alice');
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const refused = await join(cookie, pvpJoin);
      expect(refused.statusCode).toBe(422);
    }
    const limited = await join(cookie, pvpJoin);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toStrictEqual({ error: 'too-many-joins' });
    const ticket = await app.app.inject({ method: 'GET', url: '/v1/queue/tickets/me', headers: { cookie } });
    expect(ticket.json()).toStrictEqual({ ticket: null });
  });

  it('answers the waiting ticket of a signed-in player as null, when none is queued', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'GET',
      url: '/v1/queue/tickets/me',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ ticket: null });
  });

  it('answers 401 to reading the ticket with no session', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/v1/queue/tickets/me' });
    expect(response.statusCode).toBe(401);
  });

  it('answers 404 to leaving a ticket the player does not hold', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'DELETE',
      url: '/v1/queue/tickets/no-such-ticket',
      headers: { cookie, origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({ error: 'not-found' });
  });

  it('answers 401 to leaving a ticket with no session', async () => {
    const response = await app.app.inject({
      method: 'DELETE',
      url: '/v1/queue/tickets/any',
      headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });
});
