import { isSpanContextValid, type Span, SpanStatusCode, trace } from '@opentelemetry/api';

/** Span attributes: ids and bounded enums only, never codes, secrets, tokens, IP addresses or names (AWS-35). */
export type SpanAttributes = Record<string, string | number | boolean>;

const TRACER_NAME = 'd2rmm-api';

/** Adds attributes to the active span once a use case knows them (the room it loaded). Nothing happens outside a span. */
export function annotateActiveSpan(attributes: SpanAttributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/** A W3C `traceparent` of version 00: lowercase hex ids and flags, nothing else (RTL-05). */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

/**
 * The W3C `traceparent` of the active span, or null when no span is active or its context is not valid (a non-zero
 * trace id and span id). The API stores it with a room; the observation span links back to it (RTL-01, RTL-02).
 */
export function activeTraceparent(): string | null {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return null;
  }
  const flags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Adds one span link, to the trace id and span id of `traceparent`, to the active span. A value that is not a valid
 * W3C `traceparent` (wrong shape, or an all-zero trace or span id), or no active span, adds nothing and never throws
 * (RTL-03, RTL-05).
 */
export function linkActiveSpan(traceparent: string): void {
  const span = trace.getActiveSpan();
  const match = TRACEPARENT.exec(traceparent);
  if (span === undefined || match === null) {
    return;
  }
  const [, traceId, spanId, flags] = match;
  if (traceId === undefined || spanId === undefined || flags === undefined) {
    return;
  }
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) {
    return;
  }
  span.addLink({
    context: { traceId, spanId, traceFlags: Number.parseInt(flags, 16), isRemote: true },
  });
}

function isErrResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

/**
 * Runs `fn` inside an active span named `name`, and hands `fn` the span, so the caller can record an outcome attribute
 * that is known only at the end (IDB-12). The span is ended on every path. A throw records the exception and sets status
 * error before the error is rethrown.
 */
export function withRecordingSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      if (isErrResult(result)) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'err result' });
      }
      return result;
    } catch (error) {
      const exception = error instanceof Error ? error : new Error(String(error));
      span.recordException(exception);
      span.setStatus({ code: SpanStatusCode.ERROR, message: exception.name });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Runs `fn` inside an active span named `name`. The span is ended on every path. A throw records the exception and
 * sets status error before the error is rethrown; an `err` Result sets status error and is returned unchanged.
 */
export function withSpan<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T> | T): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      if (isErrResult(result)) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'err result' });
      }
      return result;
    } catch (error) {
      const exception = error instanceof Error ? error : new Error(String(error));
      span.recordException(exception);
      span.setStatus({ code: SpanStatusCode.ERROR, message: exception.name });
      throw error;
    } finally {
      span.end();
    }
  });
}
