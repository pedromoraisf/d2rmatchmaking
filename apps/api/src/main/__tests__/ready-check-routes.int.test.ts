// The ready-check routes against the migrated database (RDY-06, RDY-07, RDY-11). The full path (an agent, a formed group and
// its answers) is the acceptance suite's; here the guards and the answers of a caller in no check are the subject.
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
const AGENT_TOKEN = 'Bearer d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE';

let database: MigratedTestDatabase<AppDatabase>;
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
  const clock = new FakeClock(START);
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

describe('GET /v1/ready-checks/me', () => {
  it('answers 401 with no credential', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/v1/ready-checks/me' });
    expect(response.statusCode).toBe(401);
  });

  it('answers 204 to a signed-in player in no open check', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'GET',
      url: '/v1/ready-checks/me',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('answers 426 to an agent whose version is missing, before it reads the token (RDY-07)', async () => {
    const response = await app.app.inject({
      method: 'GET',
      url: '/v1/ready-checks/me',
      headers: { authorization: AGENT_TOKEN },
    });
    expect(response.statusCode).toBe(426);
    expect(response.json()).toStrictEqual({ error: 'upgrade-required' });
  });
});

describe('POST /v1/ready-checks/:id/accept', () => {
  it('answers 426 to an agent whose version is missing, so the minimum version applies to the hotkey (RDY-07)', async () => {
    const response = await app.app.inject({
      method: 'POST',
      url: '/v1/ready-checks/rc-1/accept',
      headers: { authorization: AGENT_TOKEN },
    });
    expect(response.statusCode).toBe(426);
  });

  it('answers 401 to an accept from the site with no session', async () => {
    const response = await app.app.inject({
      method: 'POST',
      url: '/v1/ready-checks/rc-1/accept',
      headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('answers 403 to an accept from another origin, even with a session', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'POST',
      url: '/v1/ready-checks/rc-1/accept',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('answers 404 not-found to a player who is in no such check, and changes nothing (RDY-06)', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'POST',
      url: '/v1/ready-checks/rc-1/accept',
      headers: { cookie, origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({ error: 'not-found' });
  });
});

describe('POST /v1/ready-checks/:id/decline', () => {
  it('answers 404 not-found to a player who is in no such check', async () => {
    const cookie = await signedInCookie('Alice');
    const response = await app.app.inject({
      method: 'POST',
      url: '/v1/ready-checks/rc-1/decline',
      headers: { cookie, origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({ error: 'not-found' });
  });
});
