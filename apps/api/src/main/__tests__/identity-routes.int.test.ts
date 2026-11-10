import { randomUUID } from 'node:crypto';
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
