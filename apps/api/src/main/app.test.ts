// The application logger (OBS-26): the Fastify logger takes its trace fields from the active span, so a line written
// inside a span carries both ids and a line written outside any span carries neither.
import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appLoggerOptions, pathOf } from './app.ts';

type LogLine = Record<string, unknown>;

/** A writable stream that parses every JSON line it receives into `lines`. */
function collectingSink(lines: LogLine[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.length > 0) {
          lines.push(JSON.parse(line) as LogLine);
        }
      }
      done();
    },
  });
}

describe('the application logger', () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  it('log line inside a span carries trace_id and span_id and none outside', async () => {
    const lines: LogLine[] = [];
    const app = Fastify({ logger: appLoggerOptions(collectingSink(lines)) });
    await app.ready();
    const span = new BasicTracerProvider().getTracer('test').startSpan('test.request');
    try {
      app.log.info('outside any span');
      context.with(trace.setSpan(context.active(), span), () => {
        app.log.info('inside the span');
      });
    } finally {
      span.end();
      await app.close();
    }

    const outside = lines.find((line) => line['msg'] === 'outside any span');
    const inside = lines.find((line) => line['msg'] === 'inside the span');
    expect(outside).toBeDefined();
    expect(outside).not.toHaveProperty('trace_id');
    expect(outside).not.toHaveProperty('span_id');
    expect(inside).toBeDefined();
    expect(inside?.['trace_id']).toBe(span.spanContext().traceId);
    expect(inside?.['span_id']).toBe(span.spanContext().spanId);
  });

  it('request lines carry the path without the query, so a callback code and state never reach the log (IDB-11)', async () => {
    const lines: LogLine[] = [];
    const app = Fastify({ logger: appLoggerOptions(collectingSink(lines)) });
    app.get('/v1/auth/bnet/callback', (_request, reply) => reply.code(302).header('location', '/').send());
    await app.ready();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/bnet/callback?code=secret-code-value&state=secret-state-value',
      });
      expect(response.statusCode).toBe(302);
    } finally {
      await app.close();
    }

    const raw = JSON.stringify(lines);
    expect(raw).not.toContain('code=');
    expect(raw).not.toContain('state=');
    expect(raw).not.toContain('secret-code-value');
    expect(raw).not.toContain('secret-state-value');
    const request = lines.find((line) => line['msg'] === 'incoming request');
    expect(request).toBeDefined();
    expect(request?.['req']).toMatchObject({ method: 'GET', url: '/v1/auth/bnet/callback' });
  });
});

describe('pathOf', () => {
  it('cuts the URL at its query string and at a fragment', () => {
    expect(pathOf('/v1/auth/bnet/callback?code=a&state=b')).toBe('/v1/auth/bnet/callback');
    expect(pathOf('/v1/me#frag')).toBe('/v1/me');
    expect(pathOf('/v1/me')).toBe('/v1/me');
    expect(pathOf('')).toBe('');
  });
});
