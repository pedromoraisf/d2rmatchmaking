// RCF-01 (NFR-06, AGT-01, AGT-02): `GET /v1/agents/config` answers an agent token and no one else, tags the document with
// its version, answers 304 to a caller that holds it, and stops answering a revoked agent on its next request.
import { digestOf } from '../../modules/agents/adapters/file/agent-config-file.ts';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { AgentConfig } from '@d2rmm/contracts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';
import { AGENT_VERSION, SITE_ORIGIN, bodyOf, sessionFor, tokenFor } from './agent-reach-helpers.ts';

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

const URL_OF_CONFIG = '/v1/agents/config';

function ask(headers: Record<string, string>) {
  return app.app.inject({
    method: 'GET',
    url: URL_OF_CONFIG,
    headers: { 'x-agent-version': AGENT_VERSION, ...headers },
  });
}

describe('GET /v1/agents/config (RCF-01)', () => {
  it('serves the document to the agent token, valid against the contract, tagged with its version', async () => {
    const token = await tokenFor(app, await sessionFor(app));
    const response = await ask({ authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    const document = AgentConfig.parse(bodyOf(response));
    expect(response.headers['etag']).toBe(`"agent-config-v${document.version}-${digestOf(response.body)}"`);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(Object.keys(document).sort()).toEqual(['cadence', 'phrases', 'regions', 'thresholds', 'version']);
  });

  it('sends the same bytes to two different agents (no account data)', async () => {
    const first = await ask({ authorization: `Bearer ${await tokenFor(app, await sessionFor(app))}` });
    const second = await ask({ authorization: `Bearer ${await tokenFor(app, await sessionFor(app))}` });
    expect(second.body).toBe(first.body);
  });

  it('answers 304 with no body to a caller that names the version it holds', async () => {
    const token = await tokenFor(app, await sessionFor(app));
    const first = await ask({ authorization: `Bearer ${token}` });
    const again = await ask({
      authorization: `Bearer ${token}`,
      'if-none-match': String(first.headers['etag']),
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('answers 401 to a session cookie alone, an unknown token and no credential', async () => {
    const cookie = await sessionFor(app);
    await tokenFor(app, cookie);
    expect((await ask({ cookie })).statusCode).toBe(401);
    expect((await ask({ authorization: `Bearer d2rmm_a_${'A'.repeat(43)}` })).statusCode).toBe(401);
    expect((await ask({})).statusCode).toBe(401);
  });

  it('answers 426 before authentication when the agent version is missing or old', async () => {
    const token = await tokenFor(app, await sessionFor(app));
    const response = await app.app.inject({
      method: 'GET',
      url: URL_OF_CONFIG,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(426);
  });

  it('stops answering a revoked agent on its next request, though its token was cached', async () => {
    const cookie = await sessionFor(app);
    const token = await tokenFor(app, cookie);
    expect((await ask({ authorization: `Bearer ${token}` })).statusCode).toBe(200);

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

    expect((await ask({ authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it('is listed in openapi.json with its 200, 304, 401 and 404 answers', async () => {
    await app.app.ready();
    const document = app.app.swagger() as {
      paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
    };
    const responses = document.paths[URL_OF_CONFIG]?.get?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(['200', '304', '401', '404']);
  });
});
