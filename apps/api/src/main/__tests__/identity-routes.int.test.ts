import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const SITE_ORIGIN = 'https://site.example';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
    // A fresh node:crypto source per app: a seeded one replays the same session token in every test (the sessions
    // table is shared across tests, and its token hash is the primary key).
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: silentSink,
  });
});

afterEach(async () => {
  await app.app.close();
});

/** A test sign-in from the site's origin, as the browser sends it. */
function signIn(name: string, origin = SITE_ORIGIN) {
  return app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin, 'content-type': 'application/json' },
    payload: { name },
  });
}

/** The first Set-Cookie header of a response, or '' when there is none. */
function setCookieHeader(setCookie: unknown): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return typeof header === 'string' ? header : '';
}

/** The `name=value` pair of the session cookie in a sign-in response. */
function sessionCookieOf(setCookie: unknown): string {
  return setCookieHeader(setCookie).split(';')[0] ?? '';
}

describe('identity routes', () => {
  it('sets the session cookie', async () => {
    const response = await signIn('PlayerOne');

    expect(response.statusCode).toBe(200);
    const header = setCookieHeader(response.headers['set-cookie']);
    expect(header).toMatch(/^__Host-d2rmm_session=d2rmm_s_[A-Za-z0-9_-]{43};/);
    const attributes = header
      .split(';')
      .slice(1)
      .map((attribute) => attribute.trim());
    expect(attributes.sort()).toEqual(
      ['HttpOnly', 'Max-Age=604800', 'Path=/', 'SameSite=Lax', 'Secure'].sort(),
    );
    expect(header).not.toMatch(/domain=/i);
  });

  it('refuses an invalid name with 400 invalid-player-name and sets no cookie', async () => {
    const response = await signIn('a');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid-player-name' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers 401 on /v1/me with no session cookie', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/v1/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
  });

  it('answers 401 on /v1/me with an unknown session cookie', async () => {
    const response = await app.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie: '__Host-d2rmm_session=d2rmm_s_' + 'x'.repeat(43) },
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 401 on /v1/me with a session that is seven days old', async () => {
    const cookie = sessionCookieOf((await signIn('PlayerOne')).headers['set-cookie']);

    clock.advance(SEVEN_DAYS_MS);
    const response = await app.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });

    expect(response.statusCode).toBe(401);
  });

  it('answers 401 on /v1/me when the site route receives an Authorization header', async () => {
    const cookie = sessionCookieOf((await signIn('PlayerOne')).headers['set-cookie']);

    const response = await app.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { cookie, authorization: 'Bearer d2rmm_a_whatever' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a cross-origin sign-in with 403', async () => {
    const response = await signIn('PlayerOne', 'https://evil.example');

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'forbidden' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('a signed-in player reads the account it signed into on /v1/me', async () => {
    const signedIn = await signIn('PlayerOne');
    expect(signedIn.statusCode).toBe(200);
    const cookie = sessionCookieOf(signedIn.headers['set-cookie']);

    const response = await app.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accountId: signedIn.json().accountId, displayName: 'PlayerOne' });
  });
});
