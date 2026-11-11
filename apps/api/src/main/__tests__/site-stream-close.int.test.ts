// The hub notices a closed site stream: a client that aborts its SSE request leaves no open site stream within a second
// (queues QUE-05, the site-not-open refusal). No proxy is in the path: the test talks to the API's socket directly.
import { request as httpRequest } from 'node:http';
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
let built: BuiltApp;
let baseUrl: string;

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
  built = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: silentSink,
  });
  baseUrl = await built.app.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  // An open stream keeps the server from closing: the hub ends its streams first.
  built.hub.closeAll();
  await built.app.close();
});

/** Signs in as a test player over the socket-free injector and returns the session cookie and account id. */
async function signIn(name: string): Promise<{ cookie: string; accountId: string }> {
  const login = await built.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name },
  });
  const header = login.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  const cookie = typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
  const me = await built.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
  return { cookie, accountId: (me.json() as { accountId: string }).accountId };
}

/** Opens `GET /v1/stream` on the real socket and resolves once the response headers arrive. */
function openSiteStream(cookie: string): Promise<{ abort: () => void }> {
  const url = new URL(`${baseUrl}/v1/stream`);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: url.pathname, method: 'GET', headers: { cookie } },
      (res) => {
        expect(res.statusCode).toBe(200);
        resolve({ abort: () => req.destroy() });
        res.resume();
      },
    );
    req.on('error', (error) => {
      // An aborted request raises an error on the client; only the open itself can fail the test.
      if (!req.destroyed) {
        reject(error);
      }
    });
    req.end();
  });
}

/** Waits until the hub reports the account's site stream as open or closed, for at most `timeoutMs`. */
async function waitForStream(accountId: string, open: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (built.hub.hasSiteStream(accountId) !== open && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return built.hub.hasSiteStream(accountId) === open;
}

describe('site stream close detection (queues QUE-05)', () => {
  it('reports the stream open while the client holds it', async () => {
    const { cookie, accountId } = await signIn('Alice');
    await openSiteStream(cookie);
    expect(await waitForStream(accountId, true, 1_000)).toBe(true);
  });

  it('reports the stream closed within a second after the client aborts it', async () => {
    const { cookie, accountId } = await signIn('Alice');
    const stream = await openSiteStream(cookie);
    expect(await waitForStream(accountId, true, 1_000)).toBe(true);

    stream.abort();

    expect(await waitForStream(accountId, false, 1_000)).toBe(true);
  });

  it('counts the site streams of the account: one while open, none after the client aborts (queues QUE-05)', async () => {
    const { cookie, accountId } = await signIn('Alice');
    const stream = await openSiteStream(cookie);
    expect(built.hub.siteStreamCount(accountId)).toBe(1);

    stream.abort();

    const deadline = Date.now() + 10_000;
    while (built.hub.siteStreamCount(accountId) !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(built.hub.siteStreamCount(accountId)).toBe(0);
  });
});
