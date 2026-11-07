import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from './result.ts';
import { activeTraceparent, linkActiveSpan, withSpan } from './tracing.ts';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // A real context manager, so the span that `withSpan` makes active is the one `trace.getActiveSpan` returns.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
});

describe('withSpan', () => {
  it('opens a span with the use-case name', async () => {
    await withSpan('identity.sign-in-test-account', {}, () => 'done');

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(['identity.sign-in-test-account']);
  });

  it('passes its attributes to the span', async () => {
    await withSpan(
      'lobby.record-observation',
      { roomId: 'room-1', observationType: 'GAME_NAME_SEEN' },
      () => 1,
    );

    expect(exporter.getFinishedSpans()[0]?.attributes).toEqual({
      roomId: 'room-1',
      observationType: 'GAME_NAME_SEEN',
    });
  });

  it('ends the span on success and returns the value unchanged', async () => {
    const payload = { seats: 8 };

    const returned = await withSpan('matchmaking.form-test-match', {}, async () => payload);

    const [span] = exporter.getFinishedSpans();
    expect(returned).toBe(payload);
    expect(span).toBeDefined();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records the exception, sets status error and rethrows when fn throws', async () => {
    const failure = new Error('database down');

    await expect(
      withSpan('agents.claim-token', {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.map((event) => event.name)).toContain('exception');
    expect(span?.ended).toBe(true);
  });

  it('ends the span and sets status error when fn throws synchronously', async () => {
    await expect(
      withSpan('agents.heartbeat', {}, () => {
        throw new TypeError('bad input');
      }),
    ).rejects.toThrow(TypeError);

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('sets status error on an err Result and returns it unchanged', async () => {
    const outcome: Result<string, 'invalid-code'> = err('invalid-code');

    const returned = await withSpan('agents.pair', {}, () => outcome);

    const [span] = exporter.getFinishedSpans();
    expect(returned).toBe(outcome);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('leaves status unset for an ok Result', async () => {
    await withSpan('agents.pair', {}, () => ok('paired'));

    expect(exporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('names the span scope d2rmm-api', async () => {
    await withSpan('agents.pair', {}, () => 'done');

    expect(exporter.getFinishedSpans()[0]?.instrumentationScope.name).toBe('d2rmm-api');
  });

  it('sets the status message to err result for an err Result', async () => {
    const outcome: Result<string, 'invalid-code'> = err('invalid-code');

    await withSpan('agents.pair', {}, () => outcome);

    expect(exporter.getFinishedSpans()[0]?.status.message).toBe('err result');
  });
});

describe('activeTraceparent', () => {
  it('returns the traceparent of the active span', async () => {
    let read: string | null = null;

    await withSpan('lobby.on-match-formed', {}, () => {
      read = activeTraceparent();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(read).toBe(`00-${span?.spanContext().traceId}-${span?.spanContext().spanId}-01`);
  });

  it('returns null when no span is active', () => {
    expect(activeTraceparent()).toBeNull();
  });
});

describe('linkActiveSpan', () => {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const spanId = '00f067aa0ba902b7';

  it('links the active span once to the trace id and span id of the traceparent', async () => {
    await withSpan('lobby.record-observation', {}, () => {
      linkActiveSpan(`00-${traceId}-${spanId}-01`);
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.links).toHaveLength(1);
    expect(span?.links[0]?.context).toMatchObject({ traceId, spanId });
  });

  it.each([
    ['a value of the wrong length', `00-${traceId}-${spanId}`],
    ['a value with a non-hex trace id', `00-${'g'.repeat(32)}-${spanId}-01`],
    ['an all-zero trace id', `00-${'0'.repeat(32)}-${spanId}-01`],
    ['an all-zero span id', `00-${traceId}-${'0'.repeat(16)}-01`],
    ['an empty value', ''],
  ])('adds no link and does not throw for %s', async (_label, value) => {
    await withSpan('lobby.record-observation', {}, () => {
      expect(() => linkActiveSpan(value)).not.toThrow();
    });

    expect(exporter.getFinishedSpans()[0]?.links).toEqual([]);
  });

  it('does not throw when no span is active', () => {
    expect(() => linkActiveSpan(`00-${traceId}-${spanId}-01`)).not.toThrow();
  });
});
