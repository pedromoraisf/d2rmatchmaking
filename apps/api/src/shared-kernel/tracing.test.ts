import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok, type Result } from './result.ts';
import { withSpan } from './tracing.ts';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
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
