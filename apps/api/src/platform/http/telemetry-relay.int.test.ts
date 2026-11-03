// The telemetry relay route (OBS-10, OBS-13, OBS-20; design § Relay route). A valid batch is answered `202` with no content
// and forwarded once with the backend credentials; a body over 1 MiB is `413` and never forwarded; a content encoding other
// than `identity` is `415`. The backend is a fake OTLP server on loopback; the credentials are fakes of the ports.
import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeTelemetryBackend,
  type FakeTelemetryBackend,
} from '../../../test/support/fake-telemetry-backend.ts';
import {
  SESSION_COOKIE,
  SITE_ORIGIN,
  startRelayApp,
  type RelayApp,
} from '../../../test/support/relay-app.ts';
import { RELAY_BODY_LIMIT_BYTES, RELAY_PATH } from './telemetry-relay.ts';

const PROTOBUF = 'application/x-protobuf';
const BATCH = Buffer.from([0x0a, 0x03, 0x61, 0x62, 0x63]);

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

/** Lets a background forward that is not expected to happen show itself before the test asserts. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function send(headers: Record<string, string>, payload: Buffer | string) {
  return relay.app.inject({
    method: 'POST',
    url: RELAY_PATH,
    headers: { origin: SITE_ORIGIN, cookie: SESSION_COOKIE, ...headers },
    payload,
  });
}

describe('telemetry relay route', () => {
  it('a valid batch is answered 202 with no content and forwarded once', async () => {
    const response = await send({ 'content-type': PROTOBUF }, BATCH);

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
    await backend.waitForRequests(1);
    await settle();
    const received = backend.requests();
    expect(received).toHaveLength(1);
    const [sent] = received;
    expect(sent?.method).toBe('POST');
    expect(sent?.url).toBe('/v1/traces');
    expect(sent?.body.equals(BATCH)).toBe(true);
    expect(sent?.headers['content-type']).toBe(PROTOBUF);
    expect(sent?.headers.authorization).toBe('Bearer backend-key-secret');
    expect(sent?.headers.cookie).toBeUndefined();
    expect(sent?.headers.origin).toBeUndefined();
  });

  it('a body of 1 MiB plus one byte gets 413 and nothing is forwarded', async () => {
    const oversized = Buffer.alloc(RELAY_BODY_LIMIT_BYTES + 1, 0x61);

    const refused = await send({ 'content-type': 'application/json' }, oversized);

    expect(refused.statusCode).toBe(413);
    expect(JSON.parse(refused.body)).toEqual({ error: 'payload-too-large' });
    const accepted = await send({ 'content-type': 'application/json' }, '{}');
    expect(accepted.statusCode).toBe(202);
    await backend.waitForRequests(1);
    await settle();
    const received = backend.requests();
    expect(received).toHaveLength(1);
    expect(received[0]?.body.toString()).toBe('{}');
  });

  it('a chunked body past 1 MiB is refused while it streams and nothing is forwarded', async () => {
    const address = await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${address}${RELAY_PATH}`,
        {
          method: 'POST',
          headers: {
            origin: SITE_ORIGIN,
            cookie: SESSION_COOKIE,
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.write(Buffer.alloc(RELAY_BODY_LIMIT_BYTES, 0x61));
      request.end(Buffer.alloc(1024, 0x61));
    });

    expect(status).toBe(413);
    await settle();
    expect(backend.requests()).toHaveLength(0);
  });

  it('content-encoding other than identity gets 415', async () => {
    const gzipped = await send({ 'content-type': 'application/json', 'content-encoding': 'gzip' }, '{}');
    expect(gzipped.statusCode).toBe(415);
    expect(JSON.parse(gzipped.body)).toEqual({ error: 'unsupported-media-type' });

    const identity = await send({ 'content-type': 'application/json', 'content-encoding': 'identity' }, '{}');
    expect(identity.statusCode).toBe(202);
    await backend.waitForRequests(1);
    await settle();
    expect(backend.requests()).toHaveLength(1);
  });
});
