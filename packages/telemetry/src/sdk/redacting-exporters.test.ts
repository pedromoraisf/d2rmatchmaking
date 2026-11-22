import { SpanStatusCode, TraceFlags, type Span, type SpanOptions } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { emptyResource, resourceFromAttributes } from '@opentelemetry/resources';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { RedactingLogRecordExporter, RedactingSpanExporter } from './redacting-exporters.ts';

// A real SDK span: it is readable and can be ended, as the processors see it.
type TestSpan = ReadableSpan & Span;

const SAMPLED_SPAN_CONTEXT = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: TraceFlags.SAMPLED,
};

function startSpan(
  name: string,
  options: SpanOptions = {},
  provider: BasicTracerProvider = new BasicTracerProvider(),
): TestSpan {
  return provider.getTracer('redacting-exporters-test').startSpan(name, options) as unknown as TestSpan;
}

async function exportSpans(exporter: SpanExporter, spans: ReadableSpan[]): Promise<void> {
  await new Promise<void>((resolve) => {
    exporter.export(spans, () => resolve());
  });
}

class CapturingLogExporter implements LogRecordExporter {
  readonly exported: ReadableLogRecord[] = [];

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    this.exported.push(...logs);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}
}

function logRecord(overrides: Partial<ReadableLogRecord> = {}): ReadableLogRecord {
  return {
    hrTime: [0, 0],
    hrTimeObserved: [0, 0],
    severityText: 'INFO',
    severityNumber: 9,
    body: 'request handled',
    resource: emptyResource(),
    instrumentationScope: { name: 'test' },
    attributes: {},
    droppedAttributesCount: 0,
    ...overrides,
  };
}

async function exportLogs(exporter: RedactingLogRecordExporter, logs: ReadableLogRecord[]): Promise<void> {
  await new Promise<void>((resolve) => {
    exporter.export(logs, () => resolve());
  });
}

describe('RedactingSpanExporter', () => {
  it('removes exception message and stacktrace from span events', async () => {
    const memory = new InMemorySpanExporter();
    const span = startSpan('platform.request');
    span.recordException({
      name: 'PgError',
      message: 'duplicate key (battletag)=(Foo#1234)',
      stack: 'at insert (Foo#1234)',
    });
    span.end();

    await exportSpans(new RedactingSpanExporter(memory, 'production'), [span]);

    const [exported] = memory.getFinishedSpans();
    expect(exported?.events[0]?.attributes).toStrictEqual({ 'exception.type': 'PgError' });
  });

  it('redacts span and link attributes, clears the status message and leaves the ended span as it was', async () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider();
    const linked = startSpan('linked', {}, provider);
    linked.end();
    const span = startSpan(
      'platform.request',
      {
        attributes: {
          'url.full': 'https://d2rmm.example/v1/x?token=abc#frag',
          'http.response.status_code': 401,
          'pairing.code': 'ABCD',
        },
        links: [{ context: linked.spanContext(), attributes: { 'x-token': 'abc', 'd2r.room.id': 'room-1' } }],
      },
      provider,
    );
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'refused for Foo#1234' });
    span.end();

    await exportSpans(new RedactingSpanExporter(memory, 'production'), [span]);

    const [exported] = memory.getFinishedSpans();
    expect(exported?.attributes).toStrictEqual({
      'url.full': 'https://d2rmm.example/v1/x',
      'http.response.status_code': 401,
    });
    expect(exported?.links[0]?.attributes).toStrictEqual({ 'd2r.room.id': 'room-1' });
    expect(exported?.status).toStrictEqual({ code: SpanStatusCode.ERROR });
    expect(span.attributes).toStrictEqual({
      'url.full': 'https://d2rmm.example/v1/x?token=abc#frag',
      'http.response.status_code': 401,
      'pairing.code': 'ABCD',
    });
    expect(span.status.message).toBe('refused for Foo#1234');
  });

  it('keeps only the service, environment, agent version and sdk resource attributes', async () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        'service.name': 'd2rmm-api',
        'deployment.environment': 'production',
        'd2r.telemetry.tier': 'production',
        'host.name': 'player-pc',
        'process.pid': 4242,
        'telemetry.sdk.language': 'nodejs',
      }),
    });
    const span = startSpan('platform.request', {}, provider);
    span.end();

    await exportSpans(new RedactingSpanExporter(memory, 'production'), [span]);

    const [exported] = memory.getFinishedSpans();
    expect(exported?.resource.attributes).toStrictEqual({
      'service.name': 'd2rmm-api',
      'deployment.environment': 'production',
      'd2r.telemetry.tier': 'production',
      'telemetry.sdk.language': 'nodejs',
    });
  });
});

describe('the tier of the exporters (OBT-08, OBT-11)', () => {
  const personal = {
    'd2r.account.battletag': 'Foo#1234',
    'd2r.character.name': 'Sorc',
    'd2r.ocr.text': 'Party Sorc',
    'd2r.room.id': 'room-1',
    'pairing.code': 'ABCD',
  };

  async function exportedAttributes(tier: 'full' | 'production') {
    const memory = new InMemorySpanExporter();
    const span = startSpan('lobby.record-observation', { attributes: personal });
    span.addEvent('seen', personal);
    span.end();
    await exportSpans(new RedactingSpanExporter(memory, tier), [span]);
    const [exported] = memory.getFinishedSpans();
    return { attributes: exported?.attributes, event: exported?.events[0]?.attributes };
  }

  it('drops the staging-only keys of spans and events in production and keeps the id', async () => {
    const { attributes, event } = await exportedAttributes('production');
    expect(attributes).toStrictEqual({ 'd2r.room.id': 'room-1' });
    expect(event).toStrictEqual({ 'd2r.room.id': 'room-1' });
  });

  it('keeps the staging-only keys in full and still drops the pairing code', async () => {
    const { attributes, event } = await exportedAttributes('full');
    const expected = {
      'd2r.account.battletag': 'Foo#1234',
      'd2r.character.name': 'Sorc',
      'd2r.ocr.text': 'Party Sorc',
      'd2r.room.id': 'room-1',
    };
    expect(attributes).toStrictEqual(expected);
    expect(event).toStrictEqual(expected);
  });

  it('keeps the tier in the resource of both tiers', async () => {
    const memory = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ 'd2r.telemetry.tier': 'full', 'host.name': 'pc' }),
    });
    const span = startSpan('x', {}, provider);
    span.end();
    await exportSpans(new RedactingSpanExporter(memory, 'full'), [span]);
    expect(memory.getFinishedSpans()[0]?.resource.attributes).toStrictEqual({ 'd2r.telemetry.tier': 'full' });
  });

  it('filters log attributes and battletag text by tier', async () => {
    const record = logRecord({
      attributes: { 'd2r.account.battletag': 'Foo#1234', 'd2r.room.id': 'room-1', 'req.method': 'GET' },
      body: 'Key (battletag)=(Foo#1234) exists',
    });
    const production = new CapturingLogExporter();
    await exportLogs(new RedactingLogRecordExporter(production, 'production', () => 0), [
      { ...record, severityNumber: 17 },
    ]);
    expect(production.exported[0]?.attributes).toStrictEqual({
      'd2r.room.id': 'room-1',
      'req.method': 'GET',
    });
    expect(production.exported[0]?.body).toBe('Key (battletag)=([redacted]) exists');

    const full = new CapturingLogExporter();
    await exportLogs(new RedactingLogRecordExporter(full, 'full', () => 0), [
      { ...record, severityNumber: 17 },
    ]);
    expect(full.exported[0]?.attributes).toStrictEqual({
      'd2r.account.battletag': 'Foo#1234',
      'd2r.room.id': 'room-1',
      'req.method': 'GET',
    });
    expect(full.exported[0]?.body).toBe('Key (battletag)=(Foo#1234) exists');
  });
});

describe('RedactingLogRecordExporter', () => {
  it('drops req.url and err keys from log records', async () => {
    const inner = new CapturingLogExporter();
    const exporter = new RedactingLogRecordExporter(inner, 'production', () => 0);

    await exportLogs(exporter, [
      logRecord({
        severityNumber: 17,
        attributes: {
          level: 50,
          time: 1700000000,
          msg: 'boom',
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          span_id: '00f067aa0ba902b7',
          reqId: 'req-1',
          'req.method': 'GET',
          'req.url': '/v1/agents?token=abc',
          'res.statusCode': 500,
          responseTime: 3,
          err: { message: 'relation "lobby.rooms" failed for Foo#1234' },
          'error.message': 'Foo#1234',
          'd2r.room.id': 'room-1',
        },
      }),
    ]);

    expect(inner.exported[0]?.attributes).toStrictEqual({
      level: 50,
      time: 1700000000,
      msg: 'boom',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      reqId: 'req-1',
      'req.method': 'GET',
      'res.statusCode': 500,
      responseTime: 3,
      'd2r.room.id': 'room-1',
    });
  });

  it('scrubs the body of a log record', async () => {
    const inner = new CapturingLogExporter();
    const exporter = new RedactingLogRecordExporter(inner, 'production', () => 0);

    await exportLogs(exporter, [logRecord({ severityNumber: 13, body: 'Authorization: Bearer abc.DEF' })]);

    expect(inner.exported[0]?.body).toBe('Authorization: Bearer [redacted]');
  });

  it('exports only warn and above, or records of a sampled span', async () => {
    const inner = new CapturingLogExporter();
    const exporter = new RedactingLogRecordExporter(inner, 'production', () => 0);

    await exportLogs(exporter, [
      logRecord({ body: 'info unsampled' }),
      logRecord({ body: 'warn unsampled', severityNumber: 13 }),
      logRecord({ body: 'info sampled', spanContext: SAMPLED_SPAN_CONTEXT }),
    ]);

    expect(inner.exported.map((record) => record.body)).toStrictEqual(['warn unsampled', 'info sampled']);
  });

  it('caps exported log records at 20 a second', async () => {
    const inner = new CapturingLogExporter();
    let clock = 0;
    const exporter = new RedactingLogRecordExporter(inner, 'production', () => clock);
    const warnings = (): ReadableLogRecord[] =>
      Array.from({ length: 50 }, () => logRecord({ severityNumber: 13 }));

    await exportLogs(exporter, warnings());
    expect(inner.exported).toHaveLength(20);

    clock = 999;
    await exportLogs(exporter, warnings());
    expect(inner.exported).toHaveLength(20);

    clock = 1000;
    await exportLogs(exporter, warnings());
    expect(inner.exported).toHaveLength(40);
  });
});
