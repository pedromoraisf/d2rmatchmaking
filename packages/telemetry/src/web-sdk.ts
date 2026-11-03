// The browser bootstrap of the telemetry SDK (OBS-04, OBS-21, OBS-44; design § Site telemetry). It starts only when the site
// is built with telemetry on: a disabled start installs nothing, no provider and no exporter. The caller passes every
// setting (the site reads its Vite variables in `shared/telemetry.ts`), so this module reads no `process.env`. Spans leave
// the browser as OTLP JSON to the relay path, which the same-origin Pages proxy carries to the API.
import { context, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { StackContextManager, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { RedactingSpanExporter } from './sdk/redacting-exporters.ts';
import { createResource } from './sdk/resource.ts';
import { samplerFrom } from './sdk/sampler.ts';
import { TraceparentOnlyPropagator } from './trace-context.ts';

export const WEB_SERVICE_NAME = 'd2rmm-web';
const WEB_TRACER_NAME = 'd2rmm-web';
/** The site's batch: at most 100 spans a batch, a flush every 5 seconds, and a queue of 256 spans. */
const BATCH_OPTIONS = { scheduledDelayMillis: 5000, maxExportBatchSize: 100, maxQueueSize: 256 } as const;
const SCHEME_AND_HOST = 'https://site.invalid';

/** The `fetch` shape the site's API client uses (`shared/api-client.ts`). */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface WebTelemetryOptions {
  /** Off unless the site is built with `VITE_TELEMETRY=on`; a disabled start installs nothing. */
  readonly enabled: boolean;
  /** The sampling ratio as text (`VITE_TELEMETRY_RATIO`); the default ratio applies when it is unset or invalid. */
  readonly ratio?: string;
  /** The same-origin relay path the exporter posts to, for example `/api/v1/telemetry/traces`. */
  readonly relayPath: string;
  readonly serviceVersion: string;
  readonly environment: string;
  /** Milliseconds from an arbitrary origin; defaults to `Date.now`. Injected by tests. */
  readonly now?: () => number;
}

export interface WebTelemetryHandle {
  /** Flushes the queued spans and stops the exporter. A no-op when telemetry is off. */
  shutdown(): Promise<void>;
}

const OFF: WebTelemetryHandle = { shutdown: () => Promise.resolve() };

const propagator = new TraceparentOnlyPropagator();

const headerSetter = {
  set: (carrier: Headers, key: string, value: string) => {
    carrier.set(key, value);
  },
};

/**
 * The relay's absolute URL: the page's origin in the browser, a placeholder origin outside it. The Node exporter the
 * tests run against accepts absolute URLs only, and the browser exporter posts to the same origin either way.
 */
function relayUrl(relayPath: string): string {
  const origin = (globalThis as { location?: { origin: string } }).location?.origin ?? SCHEME_AND_HOST;
  return new URL(relayPath, origin).href;
}

/** The path of a URL (absolute or relative to the site), without its query or fragment. */
function pathOf(url: string): string {
  return new URL(url, SCHEME_AND_HOST).pathname;
}

/** A navigation target as its path alone: the query and the fragment are cut, so no secret in a URL reaches a span. */
function pathOnly(pathname: string): string {
  return pathname.split(/[?#]/u)[0] ?? '';
}

function tracer() {
  return trace.getTracer(WEB_TRACER_NAME);
}

/**
 * Starts the site's traces when `enabled`: a tracer provider with the shared sampler, a batch of redacted spans and the
 * OTLP JSON exporter at the relay path. It registers the provider and the traceparent-only propagator globally.
 */
export function startWebTelemetry(options: WebTelemetryOptions): WebTelemetryHandle {
  if (!options.enabled) {
    return OFF;
  }
  const exporter = new OTLPTraceExporter({ url: relayUrl(options.relayPath) });
  const provider = new WebTracerProvider({
    resource: createResource({
      serviceName: WEB_SERVICE_NAME,
      serviceVersion: options.serviceVersion,
      environment: options.environment,
    }),
    sampler: samplerFrom(options.ratio, options.now),
    spanProcessors: [new BatchSpanProcessor(new RedactingSpanExporter(exporter), BATCH_OPTIONS)],
  });
  provider.register({ contextManager: new StackContextManager(), propagator });
  return {
    shutdown: () => provider.shutdown(),
  };
}

/**
 * Wraps a `fetch` in a client span `HTTP <METHOD> <path>`. The span records the path alone (`url.path`), and the request
 * carries the `traceparent` of that span. The response status is recorded; a 5xx or a failed call marks the span as an error.
 */
export function tracingFetcher(base: Fetcher): Fetcher {
  return (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = pathOf(url);
    return tracer().startActiveSpan(
      `HTTP ${method} ${path}`,
      { kind: SpanKind.CLIENT, attributes: { 'http.request.method': method, 'url.path': path } },
      async (span) => {
        const headers = new Headers(init.headers);
        propagator.inject(trace.setSpan(context.active(), span), headers, headerSetter);
        try {
          const response = await base(url, { ...init, headers });
          span.setAttribute('http.response.status_code', response.status);
          if (response.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          return response;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  };
}

/**
 * Runs `action` inside a span named `name` and ends the span when it returns, or when the promise it returns settles. The
 * action runs synchronously, so a call it makes (the API client's `fetch`) happens inside the span.
 */
export function tracedAction<T>(name: string, action: () => T): T {
  return tracer().startActiveSpan(name, (span) => runInSpan(span, action));
}

function runInSpan<T>(span: Span, action: () => T): T {
  let result: T;
  try {
    result = action();
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw error;
  }
  if (result instanceof Promise) {
    return result.then(
      (value: unknown) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw error;
      },
    ) as T;
  }
  span.end();
  return result;
}

/** One `web.navigation` span for a page view: the start of the page and each `popstate`. Only the path is recorded. */
export function navigationSpan(pathname: string): void {
  const span = tracer().startSpan('web.navigation', { attributes: { 'url.path': pathOnly(pathname) } });
  span.end();
}
