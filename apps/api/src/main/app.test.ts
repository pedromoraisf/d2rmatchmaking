// The application logger (OBS-26): the Fastify logger takes its trace fields from the active span, so a line written
// inside a span carries both ids and a line written outside any span carries neither.
import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appLoggerOptions } from './app.ts';

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
});
