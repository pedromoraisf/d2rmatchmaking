// `GET /v1/agents/config` over fakes (RCF-01): the guards are stand-ins that record who was asked, the use case is the real
// one over an in-memory source. The guards' own behaviour is proved by the integration tests (agent-token-reach).
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { servedConfigOf, type ServedAgentConfig } from '../../domain/agent-config.ts';
import { createGetAgentConfig } from '../../application/get-agent-config.ts';
import { MemoryAgentConfigSource } from '../memory/memory-agent-config-source.ts';
import { agentsRoutes, type AgentsRouteDeps } from './routes.ts';

/** A digest of the served bytes, as the adapter computes it; the tests only need it to be stable. */
const DIGEST = '0123456789abcdef';
const TAG = `"agent-config-v2-${DIGEST}"`;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const BODY = '{"version":2,"cadence":{"probeEvery":90}}';

async function setup(served: ServedAgentConfig | undefined, allowed = true) {
  const source = new MemoryAgentConfigSource(served);
  const order: string[] = [];
  const guard = (name: string, pass: boolean) => async (_request: unknown, reply: FastifyReply) => {
    order.push(name);
    return pass ? undefined : reply.code(401).send({ error: 'unauthenticated' });
  };
  const useCases = {
    getAgentConfig: createGetAgentConfig({ configSource: source }),
  } as unknown as AgentsRouteDeps['useCases'];
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  agentsRoutes(app, {
    useCases,
    guards: {
      requireAgentVersion: guard('version', true),
      requireAgent: guard('agent', allowed),
      requireSession: guard('session', false),
      requireSameOrigin: guard('origin', false),
      limitAgentStatus: guard('limit', false),
    },
  });
  return { app, source, order };
}

describe('GET /v1/agents/config', () => {
  it('serves the document as it was validated, tagged with its version', async () => {
    const { app: server } = await setup(servedConfigOf(2, BODY, DIGEST));
    const response = await server.inject({ method: 'GET', url: '/v1/agents/config' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(BODY);
    expect(response.headers['etag']).toBe(TAG);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });

  it('answers 304 with no body when If-None-Match names the version', async () => {
    const { app: server } = await setup(servedConfigOf(2, BODY, DIGEST));
    const response = await server.inject({
      method: 'GET',
      url: '/v1/agents/config',
      headers: { 'if-none-match': TAG },
    });
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
    expect(response.headers['etag']).toBe(TAG);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves the document again when If-None-Match names another version', async () => {
    const { app: server } = await setup(servedConfigOf(2, BODY, DIGEST));
    const response = await server.inject({
      method: 'GET',
      url: '/v1/agents/config',
      headers: { 'if-none-match': `"agent-config-v1-${DIGEST}"` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(BODY);
  });

  it('answers 404 when no configuration is served, still not cached', async () => {
    const { app: server } = await setup(undefined);
    const response = await server.inject({ method: 'GET', url: '/v1/agents/config' });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toStrictEqual({ error: 'not-found' });
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['etag']).toBeUndefined();
  });

  it('runs the version gate, then the agent guard, and stops at a refusal', async () => {
    const { app: server, order } = await setup(servedConfigOf(2, BODY, DIGEST), false);
    const response = await server.inject({ method: 'GET', url: '/v1/agents/config' });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('cadence');
    expect(order).toEqual(['version', 'agent']);
  });

  it('sends the same bytes to every caller: no header or query changes the body', async () => {
    const { app: server } = await setup(servedConfigOf(2, BODY, DIGEST));
    const first = await server.inject({ method: 'GET', url: '/v1/agents/config' });
    const second = await server.inject({
      method: 'GET',
      url: '/v1/agents/config?account=1',
      headers: { 'x-agent-version': '9.9.9', 'x-account': 'someone' },
    });
    expect(second.body).toBe(first.body);
  });

  it('serves a replaced document at once, raw, even when it is not valid JSON (staging test control)', async () => {
    const { app: server, source } = await setup(servedConfigOf(2, BODY, DIGEST));
    source.replace(servedConfigOf(3, 'not json', DIGEST));
    const response = await server.inject({ method: 'GET', url: '/v1/agents/config' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('not json');
    source.reset();
    expect((await server.inject({ method: 'GET', url: '/v1/agents/config' })).body).toBe(BODY);
  });
});
