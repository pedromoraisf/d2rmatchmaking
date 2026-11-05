// The relay forwarder (OBS-15, OBS-16): the body goes on unchanged with the backend credentials, a redirect or a failure
// logs one line without the body, the headers or the credentials, nothing is retried, the response body is cancelled, and
// at most 32 forwards and 8 MiB are in flight. The backend is a fake `fetch`.
import { describe, expect, it } from 'vitest';
import type { ErrorLog } from '../error-log.ts';
import { Forwarder, MAX_BYTES_IN_FLIGHT, type FetchLike } from './relay-forwarder.ts';

const ENDPOINT = 'https://otlp.example.com';
const CREDENTIALS = { authorization: 'Bearer backend-key-secret' };
const PAYLOAD = new Uint8Array([0x0a, 0x00, 0xff, 0x7b]);

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function setup(options: { readonly fetch?: FetchLike; readonly endpoint?: string | undefined } = {}) {
  const calls: Recorded[] = [];
  const messages: string[] = [];
  const log: ErrorLog = { error: (message) => messages.push(message) };
  const fetch: FetchLike = options.fetch ?? (async () => new Response(null, { status: 200 }));
  // The one recorder of every call: the fake backend behind it answers, the wrapper keeps the call.
  const recording: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return fetch(url, init);
  };
  const forwarder = new Forwarder({
    endpoint: options.endpoint === undefined && 'endpoint' in options ? undefined : ENDPOINT,
    credentials: CREDENTIALS,
    fetch: recording,
    log,
  });
  return { forwarder, calls, messages };
}

describe('Forwarder', () => {
  it('forwards the body unchanged with the backend credentials', async () => {
    const { forwarder, calls } = setup();

    await forwarder.forward(PAYLOAD, 'application/x-protobuf');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${ENDPOINT}/v1/traces`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe(PAYLOAD);
    expect(call?.init.headers).toEqual({
      'content-type': 'application/x-protobuf',
      authorization: 'Bearer backend-key-secret',
    });
    expect(call?.init.redirect).toBe('manual');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a redirect is refused and a failure is logged once without credentials', async () => {
    let attempts = 0;
    const { forwarder, calls, messages } = setup({
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } });
        }
        throw new TypeError('connect failed for Bearer backend-key-secret');
      },
    });

    await forwarder.forward(PAYLOAD, 'application/json');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('status=302');

    await forwarder.forward(PAYLOAD, 'application/json');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain('error=TypeError');

    expect(calls).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toContain('backend-key-secret');
      expect(message).not.toContain('Bearer');
      expect(message).not.toContain('traces');
    }
  });

  it('drops the 33rd concurrent forward', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const { forwarder, calls, messages } = setup({
      fetch: () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    });

    const settled: Promise<void>[] = [];
    for (let i = 0; i < 33; i += 1) {
      settled.push(forwarder.forward(PAYLOAD, 'application/json'));
    }

    expect(calls).toHaveLength(32);
    expect(messages).toHaveLength(1);
    for (const resolve of resolvers) {
      resolve(new Response(null, { status: 200 }));
    }
    await Promise.all(settled);
    expect(messages).toHaveLength(1);
  });

  it('drops a forward that would take the buffered bodies past 8 MiB', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const { forwarder, calls, messages } = setup({
      fetch: () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    });
    const large = new Uint8Array(MAX_BYTES_IN_FLIGHT - 10);

    const first = forwarder.forward(large, 'application/json');
    const second = forwarder.forward(new Uint8Array(11), 'application/json');

    expect(calls).toHaveLength(1);
    expect(messages).toHaveLength(1);
    for (const resolve of resolvers) {
      resolve(new Response(null, { status: 200 }));
    }
    await Promise.all([first, second]);
  });

  it('cancels the backend response body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { forwarder } = setup({ fetch: async () => new Response(body, { status: 200 }) });

    await forwarder.forward(PAYLOAD, 'application/json');

    expect(cancelled).toBe(true);
  });

  it('sends nothing when no endpoint is configured', async () => {
    const { forwarder, calls, messages } = setup({ endpoint: undefined });

    await forwarder.forward(PAYLOAD, 'application/json');

    expect(calls).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});
