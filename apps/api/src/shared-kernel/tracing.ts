import { SpanStatusCode, trace } from '@opentelemetry/api';

/** Span attributes: ids and bounded enums only, never codes, secrets, tokens, IP addresses or names (AWS-35). */
export type SpanAttributes = Record<string, string | number | boolean>;

const TRACER_NAME = 'd2rmm-api';

function isErrResult(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
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
