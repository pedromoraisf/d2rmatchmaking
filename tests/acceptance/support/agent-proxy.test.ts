import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { awaitRequest, startRecordingProxy, traceIdOf, type RecordingProxy } from './agent-proxy.ts';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${TRACE}-00f067aa0ba902b7-01`;

let upstream: http.Server;
let upstreamUrl: string;
let proxy: RecordingProxy | undefined;

beforeEach(async () => {
  upstream = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      response.writeHead(201, {
        'content-type': 'application/json',
        'x-seen-host': String(request.headers.host),
      });
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          body,
          traceparent: request.headers['traceparent'],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

describe('the recording proxy', () => {
  it('forwards the request unchanged and records its method, path and traceparent', async () => {
    proxy = await startRecordingProxy(upstreamUrl);
    const response = await fetch(`${proxy.url}/v1/lobby-rooms/mmbaalh-1/observations?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', traceparent: TRACEPARENT },
      body: '{"room":"mmbaalh-1"}',
    });
    const answer = (await response.json()) as {
      method: string;
      url: string;
      body: string;
      traceparent: string;
    };

    expect(response.status).toBe(201);
    expect(response.headers.get('x-seen-host')).toBe(new URL(upstreamUrl).host);
    expect(answer).toStrictEqual({
      method: 'POST',
      url: '/v1/lobby-rooms/mmbaalh-1/observations?x=1',
      body: '{"room":"mmbaalh-1"}',
      traceparent: TRACEPARENT,
    });
    expect(proxy.requests()).toStrictEqual([
      { method: 'POST', path: '/v1/lobby-rooms/mmbaalh-1/observations', traceparent: TRACEPARENT },
    ]);
  });

  it('records a request without a traceparent as undefined, and awaitRequest reports what was seen', async () => {
    proxy = await startRecordingProxy(upstreamUrl);
    await fetch(`${proxy.url}/v1/agents/heartbeat`, { method: 'POST' });

    await expect(
      awaitRequest(proxy, 'stream request', (record) => record.path === '/v1/stream', 200),
    ).rejects.toThrow(/no stream request within 200 ms; it sent: \[POST \/v1\/agents\/heartbeat\]/u);
    const found = await awaitRequest(
      proxy,
      'heartbeat',
      (record) => record.path === '/v1/agents/heartbeat',
      200,
    );
    expect(found.traceparent).toBeUndefined();
  });
});

describe('the recording proxy streams', () => {
  it('hands the headers of an event stream on at once, before any body chunk', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      void held.then(() => response.end('data: done\n\n'));
    });
    await new Promise<void>((resolve) => stream.listen(0, '127.0.0.1', () => resolve()));
    const streamUrl = `http://127.0.0.1:${(stream.address() as AddressInfo).port}`;
    proxy = await startRecordingProxy(streamUrl);
    try {
      const response = await fetch(`${proxy.url}/v1/stream`, {
        headers: { traceparent: TRACEPARENT },
        signal: AbortSignal.timeout(3_000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
    } finally {
      release?.();
      await new Promise<void>((resolve) => stream.close(() => resolve()));
    }
  });
});

describe('traceIdOf', () => {
  it('reads the trace id of a W3C traceparent and rejects any other value', () => {
    expect(traceIdOf(TRACEPARENT)).toBe(TRACE);
    expect(() => traceIdOf(undefined)).toThrow(/no valid traceparent \(none\)/u);
    expect(() => traceIdOf('00-short-00f067aa0ba902b7-01')).toThrow(/no valid traceparent/u);
  });
});
