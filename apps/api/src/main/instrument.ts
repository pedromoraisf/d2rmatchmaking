// The preload (AD-094, OBS-01 to OBS-03): `node --import ./src/main/instrument.ts <root>` runs this file before the root
// imports fastify, pg and http, because their instrumentation patches the modules as they load. With
// OTEL_EXPORTER_OTLP_ENDPOINT unset it installs nothing. A failure while installing is written once to stderr by name,
// and the process continues without telemetry. The roots import `telemetry-lifecycle.ts`, never this file, so the
// SDK is installed only by the preload.
import { register } from 'node:module';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { TraceparentOnlyPropagator } from '@d2rmm/telemetry';
import { startNodeTelemetry } from '@d2rmm/telemetry/node';
import { loadConfig } from './config.ts';
import { registerTelemetryHandle } from './telemetry-lifecycle.ts';

/** The service name the dashboard filters on (OBS-35). */
const SERVICE_NAME = 'd2rmm-api';
/** The API has no version of its own yet; the package version is 0.0.0. */
const SERVICE_VERSION = '0.0.0';
/** Requests that are not traced as server spans: the health check and the relay, which must not trace itself. */
const UNTRACED_PATHS: ReadonlySet<string> = new Set(['/healthz', '/v1/telemetry/traces']);

function pathOf(request: IncomingMessage): string {
  return (request.url ?? '').split('?')[0] ?? '';
}

function reportExportError(error: unknown): void {
  const name = error instanceof Error ? error.name : 'unknown';
  process.stderr.write(`telemetry export failed (${name}); further failures are reported once a minute\n`);
}

/** Starts the SDK and the instrumentations when the endpoint is set. Returns without effect otherwise. */
function installTelemetry(): void {
  const config = loadConfig();
  const settings = config.telemetry;
  if (settings.endpoint === undefined) {
    return;
  }
  const exporterHost = new URL(settings.endpoint).hostname;
  // ESM modules are patched through import-in-the-middle's loader hook, which must be registered before the roots load.
  register('import-in-the-middle/hook.mjs', import.meta.url);
  const handle = startNodeTelemetry({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    environment: config.environment,
    endpoint: settings.endpoint,
    headers: { ...settings.headers },
    samplerArg: settings.samplerArg,
    intervalMs: settings.intervalMs,
    onExportError: reportExportError,
  });
  // The SDK 2.x providers do not register a context manager: without one, a span never becomes the parent of the
  // spans that run inside its request (the pg spans would be roots).
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(handle.tracerProvider);
  metrics.setGlobalMeterProvider(handle.meterProvider);
  logs.setGlobalLoggerProvider(handle.loggerProvider);
  propagation.setGlobalPropagator(new TraceparentOnlyPropagator());
  registerInstrumentations({
    tracerProvider: handle.tracerProvider,
    meterProvider: handle.meterProvider,
    loggerProvider: handle.loggerProvider,
    instrumentations: [
      new HttpInstrumentation({
        // Header capture (headersToSpanAttributes) stays unset: credentials never reach a span (OBS-28).
        ignoreIncomingRequestHook: (request) => UNTRACED_PATHS.has(pathOf(request)),
        // The exporters' own requests would otherwise trace the export of their traces.
        ignoreOutgoingRequestHook: (options: RequestOptions) => options.hostname === exporterHost,
      }),
      // @fastify/otel is not used: its INTERNAL `request` span sits between the HTTP server span and the handler, so the
      // pg span would be a grandchild of the server span, and OBS-03 asks for a child (tasks.md Handoff, T13).
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new PinoInstrumentation(),
    ],
  });
  registerTelemetryHandle(handle);
}

try {
  installTelemetry();
} catch (error) {
  const name = error instanceof Error ? error.name : 'unknown';
  process.stderr.write(
    `telemetry disabled: the preload failed to load (${name}); the process continues without it\n`,
  );
}
