import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVE_SPAN_DETAIL, NO_SPAN_DETAIL } from './span-detail.ts';
import { withSpan } from './tracing.ts';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

describe('SpanDetail (OBT-04)', () => {
  it('the full tier puts the attributes on the active span', async () => {
    await withSpan('x', {}, () => {
      ACTIVE_SPAN_DETAIL.annotate({ 'd2r.character.name': 'Sorc' });
    });
    expect(exporter.getFinishedSpans()[0]?.attributes).toStrictEqual({ 'd2r.character.name': 'Sorc' });
  });

  it('the production tier records nothing', async () => {
    await withSpan('x', {}, () => {
      NO_SPAN_DETAIL.annotate({ 'd2r.character.name': 'Sorc' });
    });
    expect(exporter.getFinishedSpans()[0]?.attributes).toStrictEqual({});
  });

  it('does nothing outside a span', () => {
    expect(() => {
      ACTIVE_SPAN_DETAIL.annotate({ 'd2r.character.name': 'Sorc' });
    }).not.toThrow();
  });
});
