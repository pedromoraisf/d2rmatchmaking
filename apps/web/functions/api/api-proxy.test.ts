// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { proxyRequest, type ProxyContext, type Upstream } from './[[path]].ts';

const env = { API_ORIGIN: 'https://api.example.test' };

// Records what the upstream receives and answers with the given response.
function recordingUpstream(answer: () => Response = () => new Response('{}', { status: 200 })) {
  const calls: { target: URL; init: RequestInit }[] = [];
  const upstream: Upstream = async (target, init) => {
    calls.push({ target, init });
    return answer();
  };
  return { upstream, calls };
}

function context(url: string, init?: RequestInit): ProxyContext {
  return { request: new Request(url, init), env };
}

describe('Pages Function proxy', () => {
  it('forwards /api/v1/me to API_ORIGIN/v1/me with the query string', async () => {
    const { upstream, calls } = recordingUpstream();
    await proxyRequest(context('https://site.test/api/v1/me?probe=1'), upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target.href).toBe('https://api.example.test/v1/me?probe=1');
  });

  it('rejects hostile paths with 404 and never calls the API', async () => {
    const hostile = [
      '/api/__test/reset',
      '/api/__test/redeliver-match-formed',
      '/api/v1/../x',
      '/api/v1//x',
      '/api/v1%2fx',
      '/api/v1%5cx',
      '/api/v1/%252e%252e/x',
      '/api/v1%252fx',
      '/api/other/me',
    ];
    for (const path of hostile) {
      const { upstream, calls } = recordingUpstream();
      const response = await proxyRequest(context(`https://site.test${path}`), upstream);
      expect(response.status, path).toBe(404);
      expect(calls, path).toHaveLength(0);
    }
  });

  it('drops Authorization and X-Agent-Version and keeps the allow-listed headers', async () => {
    const { upstream, calls } = recordingUpstream();
    await proxyRequest(
      context('https://site.test/api/v1/me', {
        headers: {
          Cookie: '__Host-d2rmm_session=d2rmm_s_x',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer d2rmm_a_forged',
          'X-Agent-Version': '9.9.9',
          Host: 'evil.example.test',
          'X-Forwarded-For': '203.0.113.9',
          'CF-Connecting-IP': '203.0.113.9',
        },
      }),
      upstream,
    );
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get('cookie')).toBe('__Host-d2rmm_session=d2rmm_s_x');
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('accept')).toBe('application/json');
    for (const dropped of [
      'authorization',
      'x-agent-version',
      'host',
      'x-forwarded-for',
      'cf-connecting-ip',
    ]) {
      expect(sent.has(dropped), dropped).toBe(false);
    }
  });

  it('forwards traceparent and tracestate to the API', async () => {
    const { upstream, calls } = recordingUpstream();
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const tracestate = 'd2r=sampled:1';
    await proxyRequest(
      context('https://site.test/api/v1/telemetry/traces', {
        method: 'POST',
        headers: { traceparent, tracestate, 'Content-Type': 'application/x-protobuf' },
        body: 'span-bytes',
      }),
      upstream,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target.href).toBe('https://api.example.test/v1/telemetry/traces');
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get('traceparent')).toBe(traceparent);
    expect(sent.get('tracestate')).toBe(tracestate);
  });

  it('drops an oversized tracestate', async () => {
    const { upstream, calls } = recordingUpstream();
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const oversized = `d2r=${'x'.repeat(512)}`;
    await proxyRequest(
      context('https://site.test/api/v1/telemetry/traces', {
        method: 'POST',
        headers: { traceparent, tracestate: oversized },
        body: 'span-bytes',
      }),
      upstream,
    );
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.has('tracestate')).toBe(false);
    expect(sent.get('traceparent')).toBe(traceparent);
  });

  it('passes Set-Cookie from the API back to the browser', async () => {
    const { upstream } = recordingUpstream(
      () =>
        new Response(null, {
          status: 200,
          headers: [
            ['set-cookie', '__Host-d2rmm_session=d2rmm_s_abc; HttpOnly; Secure; SameSite=Lax; Path=/'],
          ],
        }),
    );
    const response = await proxyRequest(
      context('https://site.test/api/v1/auth/test-login', { method: 'POST' }),
      upstream,
    );
    expect(response.headers.getSetCookie()).toStrictEqual([
      '__Host-d2rmm_session=d2rmm_s_abc; HttpOnly; Secure; SameSite=Lax; Path=/',
    ]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('delivers a streamed body chunk by chunk, before the upstream sends the rest', async () => {
    const hooks: { push?: (text: string) => void; finish?: () => void } = {};
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        hooks.push = (text) => controller.enqueue(encoder.encode(text));
        hooks.finish = () => controller.close();
      },
    });
    const { upstream } = recordingUpstream(
      () => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const response = await proxyRequest(context('https://site.test/api/v1/stream'), upstream);
    const body = response.body;
    if (body === null) {
      throw new Error('the proxied response has no body');
    }
    const reader = body.getReader();

    hooks.push?.('id: 1\n\n');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('id: 1\n\n');

    hooks.push?.('id: 2\n\n');
    hooks.finish?.();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe('id: 2\n\n');
    expect((await reader.read()).done).toBe(true);
  });

  it('answers /healthz on the same origin and forwards the method of a POST', async () => {
    const { upstream, calls } = recordingUpstream();
    await proxyRequest(context('https://site.test/api/healthz'), upstream);
    await proxyRequest(
      context('https://site.test/api/v1/staging/match-formed', { method: 'POST', body: '{}' }),
      upstream,
    );
    expect(calls[0]?.target.href).toBe('https://api.example.test/healthz');
    expect(calls[1]?.init.method).toBe('POST');
    expect(calls[1]?.target.href).toBe('https://api.example.test/v1/staging/match-formed');
  });

  it('aborts the upstream request when the browser aborts its request (the site stream closes)', async () => {
    const { upstream, calls } = recordingUpstream(() => new Response('', { status: 200 }));
    const browser = new AbortController();
    await proxyRequest(
      { request: new Request('https://site.test/api/v1/stream', { signal: browser.signal }), env },
      upstream,
    );
    const upstreamSignal = calls[0]?.init.signal;
    expect(upstreamSignal?.aborted).toBe(false);
    browser.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });
});

describe('preview API upstream (ADR 030)', () => {
  const previewApi = {
    origin: 'https://d2rmm-api-pr-7.onrender.com',
    siteOrigin: 'https://d2rmatchmaking.pages.dev',
  };

  it('proxies to the baked preview API and presents the origin it accepts', async () => {
    const { upstream, calls } = recordingUpstream();
    await proxyRequest(
      {
        request: new Request('https://feat.site.test/api/v1/me?x=1', {
          headers: { Origin: 'https://feat.site.test' },
        }),
        env,
        previewApi,
      },
      upstream,
    );
    expect(calls[0]?.target.href).toBe('https://d2rmm-api-pr-7.onrender.com/v1/me?x=1');
    expect(new Headers(calls[0]?.init.headers).get('origin')).toBe('https://d2rmatchmaking.pages.dev');
  });

  it('adds no Origin header when the request had none', async () => {
    const { upstream, calls } = recordingUpstream();
    await proxyRequest(
      { request: new Request('https://feat.site.test/api/v1/me'), env, previewApi },
      upstream,
    );
    expect(new Headers(calls[0]?.init.headers).has('origin')).toBe(false);
  });

  it('falls back to API_ORIGIN when the preview API is absent or malformed', async () => {
    const malformed = [
      undefined,
      { ...previewApi, origin: 'https://evil.test' },
      { ...previewApi, origin: 'https://d2rmm-api-pr-7.onrender.com.evil.test' },
      { ...previewApi, origin: 'http://d2rmm-api-pr-7.onrender.com' },
      { ...previewApi, siteOrigin: 'https://site.test/path' },
      { ...previewApi, siteOrigin: 'javascript:alert(1)' },
    ];
    for (const candidate of malformed) {
      const { upstream, calls } = recordingUpstream();
      await proxyRequest(
        {
          request: new Request('https://site.test/api/v1/me', { headers: { Origin: 'https://site.test' } }),
          env,
          previewApi: candidate,
        },
        upstream,
      );
      expect(calls[0]?.target.href, JSON.stringify(candidate)).toBe('https://api.example.test/v1/me');
      expect(new Headers(calls[0]?.init.headers).get('origin')).toBe('https://site.test');
    }
  });
});
