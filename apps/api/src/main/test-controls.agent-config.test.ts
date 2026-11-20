// The agent-config control (RCF-05, RCF-06) over a bare app: only the control's own dependencies are real, the rest of
// the test controls' dependencies are never touched by this route.
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryAgentConfigSource } from '../modules/agents/adapters/memory/memory-agent-config-source.ts';
import { digestOf } from '../modules/agents/adapters/file/agent-config-file.ts';
import { servedConfigOf } from '../modules/agents/domain/agent-config.ts';
import { registerTestControls, TEST_CONTROL_HEADER, type TestControlDeps } from './test-controls.ts';

/** A digest of the served bytes, as the adapter computes it; the tests only need it to be stable. */
const DIGEST = '0123456789abcdef';

const SECRET = 'a-secret-for-the-unit-test';
const COMMITTED = servedConfigOf(1, '{"version":1}', DIGEST);

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup() {
  const source = new MemoryAgentConfigSource(COMMITTED);
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerTestControls(app, {
    secret: SECRET,
    stores: { agentConfig: source },
  } as unknown as TestControlDeps);
  const put = (payload: object, secret: string | undefined = SECRET) =>
    (app as FastifyInstance).inject({
      method: 'PUT',
      url: '/__test/agent-config',
      headers: { 'content-type': 'application/json', [TEST_CONTROL_HEADER]: secret },
      payload,
    });
  return { source, put };
}

describe('PUT /__test/agent-config', () => {
  it('serves the given text under the given version', async () => {
    const { source, put } = await setup();
    expect((await put({ version: 4, body: '{"version":4,"x":1}' })).statusCode).toBe(204);
    expect(source.current()).toStrictEqual(
      servedConfigOf(4, '{"version":4,"x":1}', digestOf('{"version":4,"x":1}')),
    );
  });

  it('defaults the version of the tag to 1 and keeps text that is not JSON as it is', async () => {
    const { source, put } = await setup();
    await put({ body: 'not json' });
    expect(source.current()).toStrictEqual(servedConfigOf(1, 'not json', digestOf('not json')));
  });

  it('serves nothing for a null body', async () => {
    const { source, put } = await setup();
    await put({ version: 9, body: null });
    expect(source.current()).toBeUndefined();
  });

  it('puts the committed document back on reset of the source', async () => {
    const { source, put } = await setup();
    await put({ body: null });
    source.reset();
    expect(source.current()).toStrictEqual(COMMITTED);
  });

  it('answers 403 and changes nothing without the secret', async () => {
    const { source, put } = await setup();
    const response = await put({ body: null }, 'wrong');
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toStrictEqual({ error: 'forbidden' });
    expect(source.current()).toStrictEqual(COMMITTED);
  });

  it('refuses a body that is not text or null, a bad version and a text over the limit', async () => {
    const { source, put } = await setup();
    expect((await put({ body: 3 })).statusCode).toBe(400);
    expect((await put({ version: 0, body: '{}' })).statusCode).toBe(400);
    expect((await put({ version: 2.5, body: '{}' })).statusCode).toBe(400);
    expect((await put({ body: 'x'.repeat(131073) })).statusCode).toBe(400);
    expect(source.current()).toStrictEqual(COMMITTED);
    expect((await put({ body: 'x'.repeat(131072) })).statusCode).toBe(204);
  });
});
