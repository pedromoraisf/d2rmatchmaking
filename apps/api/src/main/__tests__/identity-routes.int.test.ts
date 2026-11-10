import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  it('answers 404 on the Battle.net login and reports bnetSignIn false without credentials', async () => {
    const config = await app.app.inject({ method: 'GET', url: '/v1/config' });
    expect(config.json()).toMatchObject({ bnetSignIn: false });

    const login = await app.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });
    expect(login.statusCode).toBe(404);
  });
});

/** A loopback stand-in for Battle.net: one client, one code, one identity (the scenarios script their own). */
const FAKE_CLIENT_ID = 'public-client';
const FAKE_CLIENT_SECRET = 'client-secret-value';
const FAKE_BASIC = `Basic ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString('base64')}`;

function startFakeBattleNet(): Promise<{ readonly server: Server; readonly base: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST' && url.pathname === '/token') {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        if (form.get('code') === 'good-code' && request.headers.authorization === FAKE_BASIC) {
          response.end(JSON.stringify({ access_token: 'token-1' }));
          return;
        }
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/userinfo' &&
        request.headers.authorization === 'Bearer token-1'
      ) {
        response.end(JSON.stringify({ sub: 'sub-alice', battletag: 'Alice#1234' }));
        return;
      }
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'unauthorized' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** The `name=value` pair of the session cookie a response sets, or '' when it sets none. */
function sessionPairOf(response: { readonly headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const found = list.find((value) => value.startsWith('__Host-d2rmm_session='));
  return found?.split(';')[0] ?? '';
}

describe('identity routes with Battle.net', () => {
  let fake: { readonly server: Server; readonly base: string };
  let bnet: BuiltApp;

  beforeAll(async () => {
    fake = await startFakeBattleNet();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      fake.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  beforeEach(async () => {
    bnet = await buildApp({
      db: database.db,
      config: {
        stagingEndpoints: false,
        minAgentVersion: '0.0.1',
        siteOrigin: SITE_ORIGIN,
        trustProxyHops: 1,
        bnet: { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, baseUrl: fake.base },
      },
      clock,
      scheduler: new FakeScheduler(clock),
      random: new NodeRandomSource(),
      ids: new RandomUuidGenerator(),
      logSink: silentSink,
    });
  });

  afterEach(async () => {
    await bnet.app.close();
  });

  /** Starts a sign-in and returns its state cookie and the state Battle.net sends back. */
  async function startSignIn() {
    const login = await bnet.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });
    const location = new URL(String(login.headers['location']));
    const stateCookie = setCookieHeader(login.headers['set-cookie']).split(';')[0] ?? '';
    return { login, stateCookie, state: location.searchParams.get('state') ?? '' };
  }

  it('offers the sign-in and redirects to the Battle.net authorize endpoint', async () => {
    const config = await bnet.app.inject({ method: 'GET', url: '/v1/config' });
    expect(config.json()).toMatchObject({ bnetSignIn: true });

    const { login } = await startSignIn();

    expect(login.statusCode).toBe(302);
    expect(String(login.headers['location'])).toMatch(new RegExp(`^${fake.base}/authorize\\?`));
  });

  it('signs a visitor in through the callback, and /v1/me reads the account', async () => {
    const { stateCookie, state } = await startSignIn();

    const callback = await bnet.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=good-code&state=${state}`,
      headers: { cookie: stateCookie },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers['location']).toBe(`${SITE_ORIGIN}/`);
    const session = sessionPairOf(callback);
    expect(session).toMatch(/^__Host-d2rmm_session=d2rmm_s_/);

    const me = await bnet.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: session } });
    expect(me.json()).toMatchObject({ displayName: 'Alice' });
  });

  it('opens no session when Battle.net refuses the code', async () => {
    const { stateCookie, state } = await startSignIn();

    const callback = await bnet.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=bad-code&state=${state}`,
      headers: { cookie: stateCookie },
    });

    expect(callback.headers['location']).toBe(`${SITE_ORIGIN}/?signin=failed`);
    expect(JSON.stringify(callback.headers['set-cookie'] ?? '')).not.toContain(
      '__Host-d2rmm_session=d2rmm_s_',
    );
  });

  it('signs out: the session is deleted, and the old cookie answers 401', async () => {
    const { stateCookie, state } = await startSignIn();
    const callback = await bnet.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=good-code&state=${state}`,
      headers: { cookie: stateCookie },
    });
    const session = sessionPairOf(callback);

    const signOut = await bnet.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: SITE_ORIGIN, cookie: session, 'content-type': 'application/json' },
      payload: {},
    });
    expect(signOut.statusCode).toBe(204);

    const me = await bnet.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: session } });
    expect(me.statusCode).toBe(401);
  });
});
