import { context, trace } from '@opentelemetry/api';
import type * as OtlpTraceModule from '@opentelemetry/exporter-trace-otlp-http';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  StackContextManager,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWebTelemetry, tracingFetcher, type Fetcher, type WebTelemetryHandle } from './web-sdk.ts';

// The OTLP exporter the site creates is recorded, so a test can see whether one was created and where it posts.
const created = vi.hoisted(() => [] as { url: string | undefined }[]);

vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof OtlpTraceModule>();
  class RecordingOtlpTraceExporter extends actual.OTLPTraceExporter {
    constructor(config?: ConstructorParameters<typeof actual.OTLPTraceExporter>[0]) {
      super(config);
      created.push({ url: config?.url });
    }
  }
  return { ...actual, OTLPTraceExporter: RecordingOtlpTraceExporter };
});

const RELAY_PATH = '/api/v1/telemetry/traces';
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u;

let handle: WebTelemetryHandle | undefined;

beforeEach(() => {
  created.length = 0;
});

afterEach(async () => {
  await handle?.shutdown();
  handle = undefined;
  trace.disable();
  context.disable();
});

const ENABLED = {
  enabled: true,
  ratio: '1',
  relayPath: RELAY_PATH,
  serviceVersion: '0.0.0-test',
  environment: 'test',
} as const;

describe('web telemetry', () => {
  it('no exporter is created unless enabled', async () => {
    handle = startWebTelemetry({ ...ENABLED, enabled: false });
    await handle.shutdown();
    expect(created).toHaveLength(0);

    handle = startWebTelemetry(ENABLED);
    expect(created).toHaveLength(1);
  });

  it('exporter targets the relay path', () => {
    handle = startWebTelemetry(ENABLED);

    expect(created).toHaveLength(1);
    expect(new URL(created[0]?.url ?? '').pathname).toBe(RELAY_PATH);
  });

  it('tracing fetcher sends traceparent and records the path without the query', async () => {
    // A provider of its own, so the test can read the spans it ends.
    trace.disable();
    const spans = new InMemorySpanExporter();
    const provider = new WebTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
    provider.register({ contextManager: new StackContextManager() });

    const sent: { url: string; headers: Headers }[] = [];
    const base: Fetcher = async (url, init) => {
      sent.push({ url, headers: new Headers(init.headers) });
      return new Response('{}', { status: 200 });
    };
    const fetcher = tracingFetcher(base);

    const response = await fetcher('/api/v1/me?probe=secret', { method: 'GET' });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/v1/me?probe=secret');
    expect(sent[0]?.headers.get('traceparent')).toMatch(TRACEPARENT);
    const [finished] = spans.getFinishedSpans();
    expect(finished?.name).toBe('HTTP GET /api/v1/me');
    expect(finished?.attributes['url.path']).toBe('/api/v1/me');
    expect(finished?.attributes['http.response.status_code']).toBe(200);
    expect(JSON.stringify(finished?.attributes)).not.toContain('probe');
    expect(finished?.spanContext().traceId).toBe(sent[0]?.headers.get('traceparent')?.split('-')[1]);
    await provider.shutdown();
  });
});
