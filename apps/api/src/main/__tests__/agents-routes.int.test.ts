import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const SITE_ORIGIN = 'https://site.example';
const AGENT_VERSION = '1.0.0';

let database: MigratedTestDatabase<AppDatabase>;
let clock: FakeClock;
let app: BuiltApp;
let logLines: string[];

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  clock = new FakeClock(START);
  logLines = [];
  const logSink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logLines.push(chunk.toString());
      callback();
    },
  });
  app = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    // One random source per app: a seeded source would replay the same codes and tokens in every test.
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink,
  });
});

afterEach(async () => {
  await app.app.close();
});

interface Call {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly payload?: unknown;
}

/** One request to the app. Agent routes get `X-Agent-Version` unless a call overrides the headers. */
function call({ method, url, headers, payload }: Call) {
  return app.app.inject({
    method,
    url,
    headers: { 'x-agent-version': AGENT_VERSION, ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A parsed JSON body. Responses of these routes are always JSON when they have a body. */
function bodyOf<T>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

interface IssuedCode {
  readonly code: string;
  readonly expiresAt: string;
  readonly claimSecret: string;
}

/** An agent asks for a pairing code (AWS-05). */
function requestCode(headers?: Record<string, string>) {
  return call({
    method: 'POST',
    url: '/v1/agents/pairing-codes',
    ...(headers === undefined ? {} : { headers }),
  });
}

/** The agent claims its token with the claim secret (AWS-07, AWS-08). */
function claim(claimSecret: string) {
  return call({
    method: 'POST',
    url: '/v1/agents/pairing-codes/claim',
    headers: { 'content-type': 'application/json' },
    payload: { claimSecret },
  });
}

/**
 * A player name no other test of this file uses. The database is shared by the file's tests and one account holds one
 * agent at a time, so a shared name would carry an agent paired by an earlier test.
 */
function uniquePlayerName(): string {
  return `p${randomUUID().replaceAll('-', '').slice(0, 14)}`;
}

/** The site signs in with the test sign-in, then reads the session cookie. */
async function sessionFor(name: string): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  const setCookie = Array.isArray(header) ? (header[0] ?? '') : String(header ?? '');
  return setCookie.split(';')[0] ?? '';
}

/** The site submits a pairing code for its account (AWS-06). */
function pairCode(code: string, cookie: string, origin = SITE_ORIGIN) {
  return app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin, 'content-type': 'application/json', cookie },
    payload: { code },
  });
}

/** The site reads its agent (AWS-13). */
function myAgent(cookie: string) {
  return app.app.inject({ method: 'GET', url: '/v1/agents/me', headers: { cookie } });
}

function heartbeatBody(overrides: { readonly running?: boolean; readonly pcState?: string } = {}) {
  return {
    agentVersion: AGENT_VERSION,
    pcState: overrides.pcState ?? 'IN_QUEUE',
    game: { running: overrides.running ?? true, window: 'Diablo II', screen: 'UNKNOWN' },
    capture: { method: 'pixels', readRate: 0.9 },
  };
}

/** The agent's heartbeat with its token (AWS-10). */
function heartbeat(token: string, body: unknown = heartbeatBody()) {
  return call({
    method: 'POST',
    url: '/v1/agents/heartbeat',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body,
  });
}

/** Runs the whole pairing flow for a new agent of the given session and returns the agent's token. */
async function pairNewAgent(cookie: string): Promise<{ readonly token: string; readonly code: string }> {
  const issued = bodyOf<IssuedCode>(await requestCode());
  expect((await claim(issued.claimSecret)).statusCode).toBe(202);
  expect((await pairCode(issued.code, cookie)).statusCode).toBe(200);
  const claimed = bodyOf<{ token: string }>(await claim(issued.claimSecret));
  return { token: claimed.token, code: issued.code };
}

describe('agents routes', () => {
  it('runs the full pairing flow (201 → 202 → pair 200 → claim 200 → claim 410)', async () => {
    const issued = await requestCode();
    expect(issued.statusCode).toBe(201);
    expect(issued.headers['cache-control']).toBe('no-store');
    const { code, claimSecret, expiresAt } = bodyOf<IssuedCode>(issued);
    expect(code).toMatch(/^\d{6}$/);
    expect(new Date(expiresAt).getTime()).toBe(START.getTime() + 5 * 60 * 1000);

    const pending = await claim(claimSecret);
    expect(pending.statusCode).toBe(202);
    expect(pending.headers['cache-control']).toBe('no-store');

    const cookie = await sessionFor(uniquePlayerName());
    expect((await pairCode(code, cookie)).statusCode).toBe(200);

    const claimed = await claim(claimSecret);
    expect(claimed.statusCode).toBe(200);
    expect(claimed.headers['cache-control']).toBe('no-store');
    expect(bodyOf<{ token: string }>(claimed).token).toMatch(/^d2rmm_a_[A-Za-z0-9_-]{43}$/);

    const gone = await claim(claimSecret);
    expect(gone.statusCode).toBe(410);
  });

  it('a heartbeat issues no SQL statement', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const { token } = await pairNewAgent(cookie);

    let acquired = 0;
    const onAcquire = (): void => {
      acquired += 1;
    };
    database.pool.on('acquire', onAcquire);
    try {
      const response = await heartbeat(token);
      expect(response.statusCode).toBe(204);
    } finally {
      database.pool.off('acquire', onAcquire);
    }
    expect(acquired).toBe(0);
  });

  it('an invalid heartbeat answers 400 and keeps the previous presence', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const { token } = await pairNewAgent(cookie);
    expect((await heartbeat(token, heartbeatBody({ running: true }))).statusCode).toBe(204);

    const invalid = await heartbeat(token, heartbeatBody({ running: false, pcState: 'NOT_A_STATE' }));
    expect(invalid.statusCode).toBe(400);
    expect(bodyOf<{ error: string }>(invalid).error).toBe('invalid-request');

    const view = bodyOf<{ status: string; online: boolean; gameRunning: boolean }>(await myAgent(cookie));
    expect(view).toMatchObject({ status: 'paired', online: true, gameRunning: true });
  });

  it('ignores a forged left-most X-Forwarded-For', async () => {
    // The trusted proxy appends the real client (203.0.113.7); the left-most entry is attacker-controlled.
    for (let i = 0; i < 10; i += 1) {
      const issued = await requestCode({
        'x-agent-version': AGENT_VERSION,
        'x-forwarded-for': `10.0.0.${i}, 203.0.113.7`,
      });
      expect(issued.statusCode).toBe(201);
    }
    const limited = await requestCode({
      'x-agent-version': AGENT_VERSION,
      'x-forwarded-for': '10.0.0.99, 203.0.113.7',
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();

    const otherClient = await requestCode({
      'x-agent-version': AGENT_VERSION,
      'x-forwarded-for': '203.0.113.8',
    });
    expect(otherClient.statusCode).toBe(201);
  });

  it('logs no pairing secret', async () => {
    const issued = bodyOf<IssuedCode>(await requestCode());
    await claim(issued.claimSecret);
    const cookie = await sessionFor(uniquePlayerName());
    expect((await pairCode(issued.code, cookie)).statusCode).toBe(200);
    const token = bodyOf<{ token: string }>(await claim(issued.claimSecret)).token;

    const captured = logLines.join('');
    expect(captured.length).toBeGreaterThan(0);
    expect(captured).not.toContain(issued.claimSecret);
    expect(captured).not.toContain(token);
    expect(captured).not.toMatch(new RegExp(`\\b${issued.code}\\b`));
    expect(captured).not.toContain(cookie.slice(cookie.indexOf('=') + 1));
  });

  it('reads the paired agent on /v1/agents/me, and none before pairing', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    expect(bodyOf(await myAgent(cookie))).toEqual({ status: 'none' });

    const { token } = await pairNewAgent(cookie);
    const view = bodyOf<{ status: string; agentId: string; online: boolean; lastSeenAt: string | null }>(
      await myAgent(cookie),
    );
    expect(view).toMatchObject({ status: 'paired', online: false, lastSeenAt: null });

    expect((await heartbeat(token)).statusCode).toBe(204);
    const after = bodyOf<{ online: boolean; lastSeenAt: string | null }>(await myAgent(cookie));
    expect(after.online).toBe(true);
    expect(after.lastSeenAt).toBe(START.toISOString());
  });

  it('refuses an agent route without a version header, or below the minimum, with 426 before auth', async () => {
    const missing = await app.app.inject({ method: 'POST', url: '/v1/agents/pairing-codes' });
    expect(missing.statusCode).toBe(426);
    expect(bodyOf(missing)).toEqual({ error: 'upgrade-required' });

    const old = await requestCode({ 'x-agent-version': '0.0.0' });
    expect(old.statusCode).toBe(426);
  });

  it('refuses a heartbeat with no token or an unknown token with 401', async () => {
    const none = await app.app.inject({
      method: 'POST',
      url: '/v1/agents/heartbeat',
      headers: { 'x-agent-version': AGENT_VERSION, 'content-type': 'application/json' },
      payload: heartbeatBody(),
    });
    expect(none.statusCode).toBe(401);

    const unknown = await heartbeat('d2rmm_a_' + 'x'.repeat(43));
    expect(unknown.statusCode).toBe(401);
  });

  it('answers 400 invalid-code for an unknown code, and 403 for a cross-origin pair', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const unknown = await pairCode('123456', cookie);
    expect(unknown.statusCode).toBe(400);
    expect(bodyOf(unknown)).toEqual({ error: 'invalid-code' });

    const crossOrigin = await pairCode('123456', cookie, 'https://evil.example');
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('limits the eleventh pair submission of an account within five minutes with 429', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    for (let i = 0; i < 10; i += 1) {
      expect((await pairCode('123456', cookie)).statusCode).toBe(400);
    }
    const limited = await pairCode('123456', cookie);
    expect(limited.statusCode).toBe(429);
    expect(bodyOf(limited)).toEqual({ error: 'rate-limited' });
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('revokes the previous agent of the account when a new one is paired', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const first = await pairNewAgent(cookie);
    expect((await heartbeat(first.token)).statusCode).toBe(204);

    const second = await pairNewAgent(cookie);
    expect((await heartbeat(first.token)).statusCode).toBe(401);
    expect((await heartbeat(second.token)).statusCode).toBe(204);
  });
});
