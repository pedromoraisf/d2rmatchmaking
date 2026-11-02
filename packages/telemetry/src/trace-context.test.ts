import {
  ROOT_CONTEXT,
  TraceFlags,
  createTraceState,
  propagation,
  trace,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { TraceparentOnlyPropagator, contextFromTraceparent, traceparentOf } from './trace-context.ts';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const carrierGetter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key],
};

const carrierSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

describe('trace context helpers', () => {
  it('round trips a traceparent', () => {
    expect(traceparentOf(contextFromTraceparent(TRACEPARENT))).toBe(TRACEPARENT);
  });

  it('a malformed traceparent yields no context', () => {
    const context = contextFromTraceparent('00-not-a-trace-id-00f067aa0ba902b7-01');
    expect(trace.getSpanContext(context)).toBeUndefined();
  });

  it('returns no traceparent when there is no active span', () => {
    expect(traceparentOf(ROOT_CONTEXT)).toBeUndefined();
  });
});

describe('TraceparentOnlyPropagator', () => {
  it('ignores tracestate on extract', () => {
    const propagator = new TraceparentOnlyPropagator();
    const context = propagator.extract(
      ROOT_CONTEXT,
      { traceparent: TRACEPARENT, tracestate: 'vendor=secret-value' },
      carrierGetter,
    );

    const spanContext = trace.getSpanContext(context);
    expect(spanContext?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(spanContext?.spanId).toBe('00f067aa0ba902b7');
    expect(spanContext?.traceState).toBeUndefined();
  });

  it('injects the traceparent alone, with no tracestate or baggage', () => {
    const propagator = new TraceparentOnlyPropagator();
    const withExtras = trace.setSpanContext(
      propagation.setBaggage(ROOT_CONTEXT, propagation.createBaggage({ 'user-note': { value: 'kept-out' } })),
      {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
        traceState: createTraceState('vendor=secret-value'),
      },
    );
    const carrier: Record<string, string> = {};
    propagator.inject(withExtras, carrier, carrierSetter);

    expect(carrier).toStrictEqual({ traceparent: TRACEPARENT });
  });

  it('declares only the traceparent field', () => {
    expect(new TraceparentOnlyPropagator().fields()).toStrictEqual(['traceparent']);
  });
});
