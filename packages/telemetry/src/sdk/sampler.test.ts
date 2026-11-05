import { readFileSync } from 'node:fs';
import { ROOT_CONTEXT, SpanKind, TraceFlags, trace, type Context } from '@opentelemetry/api';
import { SamplingDecision, type SamplingResult } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { samplerFrom } from './sampler.ts';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

// The trace id fraction f = (lower 8 bytes) / 2^64 decides a ratio sample when f < ratio.
const HIGH_ZEROS = '0'.repeat(16);
const LOW_FIVE_PERCENT = `${HIGH_ZEROS}0ccccccccccccccc`;
const LOW_THIRTY_PERCENT = `${HIGH_ZEROS}4ccccccccccccccc`;
const LOW_SEVENTY_PERCENT = `${HIGH_ZEROS}b333333333333333`;

function sampledRoot(
  ratio: string | undefined,
  traceId: string,
  now: () => number = () => 0,
): SamplingResult {
  return samplerFrom(ratio, now).shouldSample(ROOT_CONTEXT, traceId, 'span', SpanKind.INTERNAL, {}, []);
}

function remoteParent(sampled: boolean): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  });
}

function localParent(sampled: boolean): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: false,
  });
}

describe('samplerFrom', () => {
  it('ratio from the variable and 0.1 when unset', () => {
    expect(sampledRoot('0.5', LOW_THIRTY_PERCENT).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(sampledRoot('0.5', LOW_SEVENTY_PERCENT).decision).toBe(SamplingDecision.NOT_RECORD);

    expect(sampledRoot(undefined, LOW_FIVE_PERCENT).decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(sampledRoot(undefined, LOW_THIRTY_PERCENT).decision).toBe(SamplingDecision.NOT_RECORD);

    expect(sampledRoot('not-a-number', LOW_THIRTY_PERCENT).decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('a local child follows its parent', () => {
    const sampler = samplerFrom('0', () => 0);
    const followed = sampler.shouldSample(localParent(true), TRACE_ID, 'child', SpanKind.INTERNAL, {}, []);
    expect(followed.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);

    const dropped = samplerFrom('1', () => 0).shouldSample(
      localParent(false),
      TRACE_ID,
      'child',
      SpanKind.INTERNAL,
      {},
      [],
    );
    expect(dropped.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('a forced sampled flag cannot exceed the cap', () => {
    let clock = 0;
    const sampler = samplerFrom('1', () => clock);
    const decide = (): SamplingDecision =>
      sampler.shouldSample(remoteParent(true), TRACE_ID, 'span', SpanKind.SERVER, {}, []).decision;

    // The shared bucket holds a burst of 40 and starts full: 100 forced flags at one instant export 40.
    const atOneInstant = Array.from({ length: 100 }, decide);
    expect(atOneInstant.filter((d) => d === SamplingDecision.RECORD_AND_SAMPLED)).toHaveLength(40);

    // One second later the bucket refills by 20 tokens.
    clock += 1000;
    const aSecondLater = Array.from({ length: 100 }, decide);
    expect(aSecondLater.filter((d) => d === SamplingDecision.RECORD_AND_SAMPLED)).toHaveLength(20);
  });

  it('decisions match the shared vector', () => {
    const vectorPath = new URL(
      '../../../../apps/agent/src-tauri/adapters/test-vectors/sampler.json',
      import.meta.url,
    );
    const vector = JSON.parse(readFileSync(vectorPath, 'utf8')) as {
      cases: { traceId: string; ratio: string; expected: 'sampled' | 'dropped' }[];
    };
    expect(vector.cases.length).toBeGreaterThanOrEqual(10);

    for (const testCase of vector.cases) {
      const result = sampledRoot(testCase.ratio, testCase.traceId);
      const decision = result.decision === SamplingDecision.RECORD_AND_SAMPLED ? 'sampled' : 'dropped';
      expect(decision, `ratio ${testCase.ratio} trace ${testCase.traceId}`).toBe(testCase.expected);
    }
  });
});
