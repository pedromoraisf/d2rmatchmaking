// The relay's checks against a fake backend (OBS-11, OBS-14, OBS-15, OBS-16, OBS-37; design § Relay route). The relay runs
// through the real plugin, guards, limiter, budget and forwarder, with fakes of the credentials. Each row of the order table
// gets its own relay, so a bucket one row fills cannot change the next row's answer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closedPortUrl,
  startFakeTelemetryBackend,
  type FakeTelemetryBackend,
} from '../../../test/support/fake-telemetry-backend.ts';
import {
  AGENT_TOKEN,
  BACKEND_AUTHORIZATION,
  SESSION_COOKIE,
  SITE_ORIGIN,
  startRelayApp,
  type RelayApp,
} from '../../../test/support/relay-app.ts';
import { ACCOUNT_REQUESTS_PER_MINUTE } from './relay-budget.ts';
import { ADDRESS_LIMIT } from './relay-limiter.ts';
import { RELAY_BODY_LIMIT_BYTES, RELAY_PATH } from './telemetry-relay.ts';

const DEFAULT_ADDRESS = '198.51.100.10';
const OTHER_ADDRESS = '198.51.100.20';
const PROTOBUF = 'application/x-protobuf';
const BATCH = Buffer.from([0x0a, 0x03, 0x61, 0x62, 0x63]);
/** Each session lookup takes a token of the 10-a-second lookup bucket, so the exhausting requests are 100 ms apart. */
const LOOKUP_SPACING_MS = 100;

interface Send {
  readonly address?: string;
  readonly headers?: Record<string, string>;
  readonly payload?: Buffer | string;
}

function post(relay: RelayApp, { address = DEFAULT_ADDRESS, headers = {}, payload = '{}' }: Send) {
  return relay.app.inject({ method: 'POST', url: RELAY_PATH, remoteAddress: address, headers, payload });
}

const SESSION_HEADERS = { origin: SITE_ORIGIN, cookie: SESSION_COOKIE, 'content-type': 'application/json' };
const AGENT_HEADERS = { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': PROTOBUF };

/** Fills the address bucket with credential-less requests (each answered 401 while under the limit). */
async function fillAddressBucket(relay: RelayApp, address: string): Promise<void> {
  for (let sent = 0; sent < ADDRESS_LIMIT; sent += 1) {
    const answered = await post(relay, { address });
    expect(answered.statusCode, `credential-less request ${sent + 1}`).toBe(401);
  }
}

/** Uses up the account's requests of the minute with valid sessions of the wrong media type (answered 415 each). */
async function exhaustAccountRequests(relay: RelayApp): Promise<void> {
  for (let sent = 0; sent < ACCOUNT_REQUESTS_PER_MINUTE; sent += 1) {
    relay.clock.advance(LOOKUP_SPACING_MS);
    const answered = await post(relay, { headers: { ...SESSION_HEADERS, 'content-type': 'text/plain' } });
    expect(answered.statusCode, `session request ${sent + 1}`).toBe(415);
  }
}

/** Lets a background forward that is not expected to happen show itself before the test asserts. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function waitUntil(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let backend: FakeTelemetryBackend;
let relay: RelayApp;

beforeEach(async () => {
  backend = await startFakeTelemetryBackend();
  relay = await startRelayApp({ endpoint: backend.url });
});

afterEach(async () => {
  await relay.close();
  await backend.close();
});

describe('telemetry relay order and failure modes', () => {
  it('the relay applies its checks in order', async () => {
    // Each row: a fresh relay, the setup it needs, then the one request whose answer the row names.
    const rows: readonly {
      readonly name: string;
      readonly run: (fresh: RelayApp) => Promise<void>;
    }[] = [
      {
        name: 'a credential-less caller at 121 a minute gets 429 before 401',
        run: async (fresh) => {
          await fillAddressBucket(fresh, DEFAULT_ADDRESS);
          const refused = await post(fresh, { address: DEFAULT_ADDRESS });
          expect(refused.statusCode).toBe(429);
          expect(refused.headers['retry-after']).toMatch(/^\d+$/);
          expect(JSON.parse(refused.body)).toStrictEqual({ error: 'rate-limited' });
        },
      },
      {
        name: 'a failed credential over the limit gets 401',
        run: async (fresh) => {
          await fillAddressBucket(fresh, DEFAULT_ADDRESS);
          const refused = await post(fresh, {
            address: DEFAULT_ADDRESS,
            headers: { authorization: 'Bearer d2rmm_a_bad' },
          });
          expect(refused.statusCode).toBe(401);
          expect(JSON.parse(refused.body)).toStrictEqual({ error: 'unauthenticated' });
        },
      },
      {
        name: 'an empty lookup bucket gets 429 without a repository call',
        run: async (fresh) => {
          for (let sent = 0; sent < 10; sent += 1) {
            const answered = await post(fresh, { headers: { authorization: `Bearer d2rmm_a_bad${sent}` } });
            expect(answered.statusCode, `bad token ${sent + 1}`).toBe(401);
          }
          const readsBefore = fresh.agents.repositoryReads;
          const throttled = await post(fresh, { headers: { authorization: 'Bearer d2rmm_a_bad_last' } });
          expect(throttled.statusCode).toBe(429);
          expect(throttled.headers['retry-after']).toBe('1');
          expect(fresh.agents.repositoryReads).toBe(readsBefore);
        },
      },
      {
        name: 'wrong origin gets 403 before rate',
        run: async (fresh) => {
          await exhaustAccountRequests(fresh);
          fresh.clock.advance(LOOKUP_SPACING_MS);
          const wrongOrigin = await post(fresh, {
            headers: { ...SESSION_HEADERS, origin: 'https://evil.example' },
          });
          expect(wrongOrigin.statusCode).toBe(403);
        },
      },
      {
        name: 'rate before type',
        run: async (fresh) => {
          await exhaustAccountRequests(fresh);
          fresh.clock.advance(LOOKUP_SPACING_MS);
          const limited = await post(fresh, {
            headers: { ...SESSION_HEADERS, 'content-type': 'text/plain' },
          });
          expect(limited.statusCode).toBe(429);
          expect(limited.headers['retry-after']).toMatch(/^\d+$/);
        },
      },
      {
        name: 'type before size',
        run: async (fresh) => {
          const oversized = Buffer.alloc(RELAY_BODY_LIMIT_BYTES + 1, 0x61);
          const refused = await post(fresh, {
            headers: { ...SESSION_HEADERS, 'content-type': 'text/plain' },
            payload: oversized,
          });
          expect(refused.statusCode).toBe(415);
          expect(JSON.parse(refused.body)).toStrictEqual({ error: 'unsupported-media-type' });
        },
      },
    ];
    for (const row of rows) {
      const fresh = await startRelayApp({ endpoint: backend.url });
      try {
        await row.run(fresh);
      } catch (error) {
        throw new Error(`order row "${row.name}" failed`, { cause: error });
      } finally {
        await fresh.close();
      }
    }
  });

  it('a valid agent is accepted while the address bucket is full', async () => {
    await fillAddressBucket(relay, DEFAULT_ADDRESS);
    const refused = await post(relay, { address: DEFAULT_ADDRESS });
    expect(refused.statusCode).toBe(429);

    const accepted = await post(relay, { address: DEFAULT_ADDRESS, headers: AGENT_HEADERS, payload: BATCH });

    expect(accepted.statusCode).toBe(202);
    await backend.waitForRequests(1);
    await settle();
    expect(backend.requests()).toHaveLength(1);
    // The other address is unaffected by the first one's bucket.
    const unrelated = await post(relay, { address: OTHER_ADDRESS });
    expect(unrelated.statusCode).toBe(401);
  });

  it('returns no backend header or body and logs no credentials', async () => {
    backend.answerWith({
      status: 200,
      headers: { 'x-backend-secret': 'backend-header-secret', 'set-cookie': 'backend=cookie-secret' },
      body: 'backend-body-secret',
    });
    const accepted = await post(relay, {
      headers: SESSION_HEADERS,
      payload: BATCH,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.body).toBe('');
    expect(accepted.headers['x-backend-secret']).toBeUndefined();
    expect(accepted.headers['set-cookie']).toBeUndefined();
    await backend.waitForRequests(1);
    await settle();

    // A failing backend is logged once, by status only: its body, headers and the credentials never reach a line.
    backend.answerWith({
      status: 500,
      headers: { 'x-backend-secret': 'backend-header-secret' },
      body: 'backend-body-secret',
    });
    const failed = await post(relay, { headers: SESSION_HEADERS, payload: BATCH });
    expect(failed.statusCode).toBe(202);
    expect(failed.body).toBe('');
    await backend.waitForRequests(2);
    await waitUntil(() => relay.logged.length === 1, 'the logged backend failure');

    const logged = relay.logged.join('\n');
    expect(logged).toContain('relay-forward-failed status=500');
    for (const secret of [
      'backend-body-secret',
      'backend-header-secret',
      'cookie-secret',
      BACKEND_AUTHORIZATION,
      'backend-key-secret',
      SESSION_COOKIE,
      AGENT_TOKEN,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('answers identically against a closed port', async () => {
    const reachable = await post(relay, { headers: AGENT_HEADERS, payload: BATCH });
    await backend.waitForRequests(1);

    const closed = await startRelayApp({ endpoint: await closedPortUrl() });
    try {
      const unreachable = await post(closed, { headers: AGENT_HEADERS, payload: BATCH });
      expect(unreachable.statusCode).toBe(reachable.statusCode);
      expect(unreachable.body).toBe(reachable.body);
      expect(Object.keys(unreachable.headers).sort()).toStrictEqual(Object.keys(reachable.headers).sort());

      // Five more batches while the backend is down: the first failed forward is logged, the rest of the minute is not.
      for (let sent = 0; sent < 5; sent += 1) {
        const answered = await post(closed, { headers: AGENT_HEADERS, payload: BATCH });
        expect(answered.statusCode).toBe(202);
      }
      await waitUntil(() => closed.logged.length >= 1, 'the first export error');
      await settle();
      expect(closed.logged).toHaveLength(1);

      // A minute later the next failed forward is logged again: at most one line a minute.
      closed.clock.advance(60 * 1000);
      const later = await post(closed, { headers: AGENT_HEADERS, payload: BATCH });
      expect(later.statusCode).toBe(202);
      await waitUntil(() => closed.logged.length >= 2, 'the export error of the next minute');
      await settle();
      expect(closed.logged).toHaveLength(2);
      expect(closed.logged.every((line) => line.startsWith('relay-forward-failed'))).toBe(true);
    } finally {
      await closed.close();
    }
  });
});
