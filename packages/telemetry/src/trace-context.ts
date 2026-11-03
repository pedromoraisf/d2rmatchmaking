// W3C trace context helpers (OBS-05, OBS-07). They use an explicit W3CTraceContextPropagator, so they work with no
// global propagator registered. The API installs TraceparentOnlyPropagator: `tracestate` and baggage are never parsed,
// stored or sent on.
import {
  ROOT_CONTEXT,
  trace,
  type Context,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const w3c = new W3CTraceContextPropagator();

const recordCarrierSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

const recordCarrierGetter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key],
};

/** The `traceparent` value of the span active in `context`, or `undefined` when there is none. */
export function traceparentOf(context: Context): string | undefined {
  const carrier: Record<string, string> = {};
  w3c.inject(context, carrier, recordCarrierSetter);
  return carrier['traceparent'];
}

/** A context holding the remote span named by `traceparent`; a malformed value yields a context with no span. */
export function contextFromTraceparent(traceparent: string): Context {
  return w3c.extract(ROOT_CONTEXT, { traceparent }, recordCarrierGetter);
}

/** Extracts `traceparent` only. Injects `traceparent` only: no `tracestate`, no baggage. */
export class TraceparentOnlyPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    const traceparent = traceparentOf(context);
    if (traceparent !== undefined) setter.set(carrier, 'traceparent', traceparent);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const value = getter.get(carrier, 'traceparent');
    const traceparent = Array.isArray(value) ? value[0] : value;
    if (traceparent === undefined) return context;
    const remote = trace.getSpanContext(contextFromTraceparent(traceparent));
    if (remote === undefined) return context;
    return trace.setSpanContext(context, remote);
  }

  fields(): string[] {
    return ['traceparent'];
  }
}
