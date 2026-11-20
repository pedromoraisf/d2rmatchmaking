// AGT-02 (NFR-06, ADR 011): a revoked or replaced agent token is refused on every agent route, even one the API had
// cached. The stream's open connection closing is proved in platform/stream-hub.int.test.ts.
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';
import { agentRoutes } from './agent-route-table.ts';
import { SITE_ORIGIN, bodyOf, send, sessionFor, tokenFor } from './agent-reach-helpers.ts';

let database: MigratedTestDatabase<AppDatabase>;
let app: BuiltApp;

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const clock = new FakeClock(new Date('2026-10-31T12:00:00.000Z'));
  app = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
});

afterEach(async () => {
  await app.app.close();
});

/** Every agent route with the token, as `METHOD path status` lines. */
async function statusesWith(
  token: string,
  { streamToo }: { readonly streamToo: boolean },
): Promise<string[]> {
  const lines: string[] = [];
  // An accepted token opens the stream and the request never ends, so the stream is asked only when 401 is expected.
  for (const route of agentRoutes().filter((candidate) => streamToo || candidate.path !== '/v1/stream')) {
    const response = await send(app, route, { authorization: `Bearer ${token}` });
    lines.push(`${route.method} ${route.path} ${response.statusCode}`);
  }
  return lines;
}

function refusedEverywhere(token: string): Promise<string[]> {
  return statusesWith(token, { streamToo: true }).then((lines) =>
    lines.filter((line) => !line.endsWith(' 401')),
  );
}

describe('a revoked agent token is refused on every agent route (AGT-02)', () => {
  it('after the player revokes the agent, even though the token was cached', async () => {
    const cookie = await sessionFor(app);
    const token = await tokenFor(app, cookie);
    // The token works first, so it is cached: the revoke has to evict it, not only mark the row.
    expect((await statusesWith(token, { streamToo: false })).filter((line) => line.endsWith(' 401'))).toEqual(
      [],
    );

    const agentId = bodyOf<{ agentId: string }>(
      await app.app.inject({ method: 'GET', url: '/v1/agents/me', headers: { cookie } }),
    ).agentId;
    const revoked = await app.app.inject({
      method: 'DELETE',
      url: `/v1/agents/${agentId}`,
      headers: { origin: SITE_ORIGIN, cookie, 'content-type': 'application/json' },
      payload: {},
    });
    expect(revoked.statusCode).toBe(204);

    expect(await refusedEverywhere(token)).toEqual([]);
  });

  it('after the player pairs a new agent, which keeps working', async () => {
    const cookie = await sessionFor(app);
    const first = await tokenFor(app, cookie);
    expect((await statusesWith(first, { streamToo: false })).filter((line) => line.endsWith(' 401'))).toEqual(
      [],
    );

    const second = await tokenFor(app, cookie);

    expect(await refusedEverywhere(first)).toEqual([]);
    expect(
      (await statusesWith(second, { streamToo: false })).filter((line) => line.endsWith(' 401')),
    ).toEqual([]);
  });
});
