import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { Kysely } from 'kysely';
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

/**
 * The app's database with every insert into the sessions table failing, as a lost connection would: the sign-in's last
 * write throws after the account is found or created (IDB-04).
 */
function withFailingSessions(db: Kysely<AppDatabase>): Kysely<AppDatabase> {
  const insertInto: Kysely<AppDatabase>['insertInto'] = (table) => {
    if (table === 'identity.sessions') {
      throw new Error('connection lost');
    }
    return db.insertInto(table);
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === 'insertInto') {
        return insertInto;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
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
  // Every byte the Battle.net app logs in a test, so a test can assert what a log line does not carry (IDB-11).
  let logged = '';
  const capturingSink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logged += chunk.toString('utf8');
      callback();
    },
  });

  beforeAll(async () => {
    fake = await startFakeBattleNet();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      fake.server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  beforeEach(async () => {
    logged = '';
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
      logSink: capturingSink,
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

  it('logs the callback request without its code or state (IDB-11)', async () => {
    const { stateCookie, state } = await startSignIn();
    const callback = await bnet.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=good-code&state=${state}`,
      headers: { cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(302);

    expect(logged).toContain('/v1/auth/bnet/callback');
    expect(logged).not.toContain('code=');
    expect(logged).not.toContain('state=');
    expect(logged).not.toContain('good-code');
    expect(logged).not.toContain(state);
  });

  it('ends a sign-in that throws in the database: the state cookie is cleared, no session is set, the player is redirected (IDB-04)', async () => {
    const failing = await buildApp({
      db: withFailingSessions(database.db),
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
    try {
      const login = await failing.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });
      const state = new URL(String(login.headers['location'])).searchParams.get('state') ?? '';
      const stateCookie = setCookieHeader(login.headers['set-cookie']).split(';')[0] ?? '';

      const callback = await failing.app.inject({
        method: 'GET',
        url: `/v1/auth/bnet/callback?code=good-code&state=${state}`,
        headers: { cookie: stateCookie },
      });

      expect(callback.statusCode).toBe(302);
      expect(callback.headers['location']).toBe(`${SITE_ORIGIN}/?signin=failed`);
      const raw = callback.headers['set-cookie'];
      const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
      expect(cookies.some((cookie) => cookie.startsWith('__Host-d2rmm_oauth=;'))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith('__Host-d2rmm_session=d2rmm_s_'))).toBe(false);
    } finally {
      await failing.app.close();
    }
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

const AGENT_VERSION = '0.3.1';

/** A player name no other test of this file uses: the sessions and accounts are shared by the file's tests. */
function uniqueName(): string {
  return `p${randomUUID().replaceAll('-', '').slice(0, 14)}`;
}

/** The site's session cookie for a fresh account. */
async function freshSession(): Promise<{ readonly cookie: string; readonly accountId: string }> {
  const response = await signIn(uniqueName());
  return { cookie: sessionCookieOf(response.headers['set-cookie']), accountId: response.json().accountId };
}

/** Runs the agent's pairing flow for the session's account and returns the agent's token (AWS-05 to AWS-08). */
async function pairedAgentToken(cookie: string): Promise<string> {
  const issued = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pairing-codes',
    headers: { 'x-agent-version': AGENT_VERSION },
  });
  const { code, claimSecret } = issued.json();
  const claimHeaders = { 'x-agent-version': AGENT_VERSION, 'content-type': 'application/json' };
  await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pairing-codes/claim',
    headers: claimHeaders,
    payload: { claimSecret },
  });
  const paired = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: { code },
  });
  expect(paired.statusCode).toBe(200);
  const claimed = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pairing-codes/claim',
    headers: claimHeaders,
    payload: { claimSecret },
  });
  return claimed.json().token;
}

const SORC = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

/** `count` distinct letters-only names from `from` on, each a valid card (three letters per index). */
function heroes(from: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index;
    const letters = [Math.floor(n / 676), Math.floor(n / 26) % 26, n % 26]
      .map((digit) => String.fromCharCode(97 + digit))
      .join('');
    return { ...SORC, name: `Hero${letters}` };
  });
}

/** The agent's batch post (CHR-09) with its token. */
function postCharacters(token: string | undefined, characters: unknown[], version = AGENT_VERSION) {
  return app.app.inject({
    method: 'POST',
    url: '/v1/me/characters',
    headers: {
      ...(version === '' ? {} : { 'x-agent-version': version }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      'content-type': 'application/json',
    },
    payload: { characters },
  });
}

/** The site's character list (CHR-11). */
function listCharacters(cookie: string) {
  return app.app.inject({ method: 'GET', url: '/v1/me/characters', headers: { cookie } });
}

describe('character routes', () => {
  it('stores the agent batch and lists it to the owner with the read time', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);

    const posted = await postCharacters(token, [SORC]);
    expect(posted.statusCode).toBe(204);

    const listed = await listCharacters(cookie);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().characters).toEqual([
      { ...SORC, readAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) },
    ]);
  });

  it('replaces the fields of a character with the newest reading', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);
    await postCharacters(token, [SORC]);

    expect((await postCharacters(token, [{ ...SORC, level: 88 }])).statusCode).toBe(204);

    const body = (await listCharacters(cookie)).json();
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({ name: 'Sorc', level: 88 });
  });

  it('answers 401 without a bearer token and with an unknown one', async () => {
    const { cookie } = await freshSession();
    await pairedAgentToken(cookie);

    expect((await postCharacters(undefined, [SORC])).statusCode).toBe(401);
    expect((await postCharacters('d2rmm_a_' + 'x'.repeat(43), [SORC])).statusCode).toBe(401);
  });

  it('answers 426 without X-Agent-Version, before the token is read', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);

    expect((await postCharacters(token, [SORC], '')).statusCode).toBe(426);
  });

  it('answers 400 for a card that breaks the contract and stores none of the batch', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);

    const posted = await postCharacters(token, [SORC, { ...SORC, name: 'Pally', level: 100 }]);

    expect(posted.statusCode).toBe(400);
    expect((await listCharacters(cookie)).json()).toEqual({ characters: [] });
  });

  it('answers 400 for more than 24 cards in one request', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);
    const characters = Array.from({ length: 25 }, (_, index) => ({
      ...SORC,
      name: `Char${String.fromCharCode(97 + index)}`,
    }));

    expect((await postCharacters(token, characters)).statusCode).toBe(400);
    expect((await listCharacters(cookie)).json()).toEqual({ characters: [] });
  });

  it('answers 400 too-many-characters past 60 names and stores none of the batch', async () => {
    const { cookie } = await freshSession();
    const token = await pairedAgentToken(cookie);
    expect((await postCharacters(token, heroes(0, 24))).statusCode).toBe(204);
    expect((await postCharacters(token, heroes(24, 24))).statusCode).toBe(204);
    expect((await postCharacters(token, heroes(48, 12))).statusCode).toBe(204);

    const refused = await postCharacters(token, heroes(60, 2));

    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: 'too-many-characters' });
    expect((await listCharacters(cookie)).json().characters).toHaveLength(60);
  });

  it('keeps the characters of one account apart from another', async () => {
    const alice = await freshSession();
    const bob = await freshSession();
    await postCharacters(await pairedAgentToken(alice.cookie), [SORC]);

    expect((await listCharacters(bob.cookie)).json()).toEqual({ characters: [] });
  });

  it('writes CharactersRecorded to the outbox for the account', async () => {
    const { cookie, accountId } = await freshSession();
    const token = await pairedAgentToken(cookie);

    await postCharacters(token, [SORC]);

    const rows = await database.pool.query<{ event_type: string }>(
      `select event_type from platform.outbox where payload->>'accountId' = $1`,
      [accountId],
    );
    expect(rows.rows.map((row) => row.event_type)).toEqual(['CharactersRecorded']);
  });

  it('answers 401 on the list without a session cookie', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/v1/me/characters' });

    expect(response.statusCode).toBe(401);
  });
});
