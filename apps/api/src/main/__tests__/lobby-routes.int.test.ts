import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
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

const spanExporter = new InMemorySpanExporter();
let database: MigratedTestDatabase<AppDatabase>;
let clock: FakeClock;
let app: BuiltApp;

beforeAll(async () => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
  );
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  clock = new FakeClock(START);
  spanExporter.reset();
  const silentSink = new Writable({
    write(_chunk, _encoding, callback) {
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
    logSink: silentSink,
  });
});

afterEach(async () => {
  await app.app.close();
});

/** A parsed JSON body. */
function bodyOf<T>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

/**
 * A player name no other test of this file uses. The database is shared by the file's tests, and every account's
 * newest room and agent are looked up by account, so a shared name would see another test's rooms.
 */
function uniquePlayerName(): string {
  return `p${randomUUID().replaceAll('-', '').slice(0, 14)}`;
}

/** The site signs in with the test sign-in and returns the session cookie. */
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

/** Pairs a new agent of the session's account and returns its token. */
async function pairNewAgent(cookie: string): Promise<string> {
  const issued = bodyOf<{ code: string; claimSecret: string }>(
    await app.app.inject({
      method: 'POST',
      url: '/v1/agents/pairing-codes',
      headers: { 'x-agent-version': AGENT_VERSION },
    }),
  );
  const pending = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pairing-codes/claim',
    headers: { 'x-agent-version': AGENT_VERSION, 'content-type': 'application/json' },
    payload: { claimSecret: issued.claimSecret },
  });
  expect(pending.statusCode).toBe(202);
  const paired = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: { code: issued.code },
  });
  expect(paired.statusCode).toBe(200);
  const claimed = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pairing-codes/claim',
    headers: { 'x-agent-version': AGENT_VERSION, 'content-type': 'application/json' },
    payload: { claimSecret: issued.claimSecret },
  });
  expect(claimed.statusCode).toBe(200);
  return bodyOf<{ token: string }>(claimed).token;
}

/** The site's test match (AWS-19): 202 with the match id, then the relay opens the room. */
async function formTestMatch(cookie: string): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/staging/match-formed',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: {},
  });
  expect(response.statusCode).toBe(202);
  await app.relay.settled();
  return bodyOf<{ matchId: string }>(response).matchId;
}

interface RoomBody {
  readonly roomId: string;
  readonly mode: string;
  readonly activity: string;
  readonly difficulty: string;
  readonly stage: string;
  readonly run: number;
  readonly expectedGameName: string;
  readonly password: string;
  readonly members: readonly {
    readonly accountId: string;
    readonly role: string;
    readonly joinOrder: number;
  }[];
}

function myRoom(cookie: string) {
  return app.app.inject({ method: 'GET', url: '/v1/me/room', headers: { cookie } });
}

function assignmentOf(token: string) {
  return app.app.inject({
    method: 'GET',
    url: '/v1/agents/me/assignment',
    headers: { 'x-agent-version': AGENT_VERSION, authorization: `Bearer ${token}` },
  });
}

function observationBody(value: string, overrides: { readonly type?: string; readonly key?: string } = {}) {
  return {
    idempotencyKey: overrides.key ?? randomUUID(),
    type: overrides.type ?? 'GAME_NAME_SEEN',
    run: 1,
    value,
    confidence: 0.9,
    capturedAt: START.toISOString(),
  };
}

/** The agent reports one observation for a room (AWS-20 to AWS-24). */
function observe(token: string, roomId: string, payload: unknown) {
  return app.app.inject({
    method: 'POST',
    url: `/v1/lobby-rooms/${roomId}/observations`,
    headers: {
      'x-agent-version': AGENT_VERSION,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    payload: payload as object,
  });
}

describe('lobby routes', () => {
  it('the test match opens a room that awaits the host, with an empty password', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    await formTestMatch(cookie);

    const response = await myRoom(cookie);
    expect(response.statusCode).toBe(200);
    const room = bodyOf<RoomBody>(response);
    expect(room).toMatchObject({
      mode: 'leveling',
      activity: 'baal',
      difficulty: 'hell',
      stage: 'awaiting_host',
      run: 1,
      password: '',
    });
    expect(room.expectedGameName).toMatch(/^mmbaalh-\d+$/);
    expect(room.members).toHaveLength(1);
    expect(room.members[0]).toMatchObject({ role: 'host', joinOrder: 1 });
  });

  it('assignment endpoint returns the room', async () => {
    const name = uniquePlayerName();
    const cookie = await sessionFor(name);
    const token = await pairNewAgent(cookie);

    expect((await assignmentOf(token)).statusCode).toBe(404);

    await formTestMatch(cookie);
    const room = bodyOf<RoomBody>(await myRoom(cookie));
    const response = await assignmentOf(token);
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({
      roomId: room.roomId,
      run: 1,
      expectedGameName: room.expectedGameName,
      members: room.members,
    });
  });

  it("the host's matching observation answers 202 and moves the room to created", async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const token = await pairNewAgent(cookie);
    await formTestMatch(cookie);
    const room = bodyOf<RoomBody>(await myRoom(cookie));

    const response = await observe(token, room.roomId, observationBody(room.expectedGameName.toUpperCase()));
    expect(response.statusCode).toBe(202);
    expect(bodyOf(response)).toEqual({ stored: true });

    const after = bodyOf<RoomBody>(await myRoom(cookie));
    expect(after.stage).toBe('created');
  });

  it('a repeated idempotency key is stored once for the agent', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const token = await pairNewAgent(cookie);
    await formTestMatch(cookie);
    const room = bodyOf<RoomBody>(await myRoom(cookie));
    const payload = observationBody(room.expectedGameName, { key: 'same-key' });

    expect(bodyOf(await observe(token, room.roomId, payload))).toEqual({ stored: true });
    expect(bodyOf(await observe(token, room.roomId, payload))).toEqual({ stored: false });
  });

  it('a non-member agent answers 403 and nothing is stored', async () => {
    const owner = await sessionFor(uniquePlayerName());
    await formTestMatch(owner);
    const room = bodyOf<RoomBody>(await myRoom(owner));

    const outsider = await sessionFor(uniquePlayerName());
    const outsiderToken = await pairNewAgent(outsider);
    const response = await observe(outsiderToken, room.roomId, observationBody(room.expectedGameName));

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toEqual({ error: 'forbidden' });
    const stored = await database.db
      .selectFrom('lobby.observations')
      .selectAll()
      .where('room_id', '=', room.roomId)
      .execute();
    expect(stored).toHaveLength(0);
  });

  it('a 5 KB body answers 413', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const token = await pairNewAgent(cookie);
    await formTestMatch(cookie);
    const room = bodyOf<RoomBody>(await myRoom(cookie));

    const response = await observe(token, room.roomId, observationBody('x'.repeat(5 * 1024)));
    expect(response.statusCode).toBe(413);
    expect(bodyOf(response)).toEqual({ error: 'payload-too-large' });
  });

  it('record-observation runs in its span', async () => {
    const cookie = await sessionFor(uniquePlayerName());
    const token = await pairNewAgent(cookie);
    await formTestMatch(cookie);
    const room = bodyOf<RoomBody>(await myRoom(cookie));
    spanExporter.reset();

    await observe(token, room.roomId, observationBody(room.expectedGameName));

    const names = spanExporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain('lobby.record-observation');
  });

  it("answers 404 for a site with no room, and hides another account's room", async () => {
    const lonely = await sessionFor(uniquePlayerName());
    const none = await myRoom(lonely);
    expect(none.statusCode).toBe(404);
    expect(bodyOf(none)).toEqual({ error: 'no-room' });

    const owner = await sessionFor(uniquePlayerName());
    await formTestMatch(owner);
    expect((await myRoom(lonely)).statusCode).toBe(404);
  });
});
