// The Node bootstrap of the telemetry SDK (OBS-01, OBS-39). It builds the providers from the shared pieces (resource,
// sampler, views, redacting exporters) and returns them in a handle. It reads no process.env: the caller passes every
// setting, so the composition root alone decides where the configuration comes from.
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor, LoggerProvider, type ReadableLogRecord } from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { RedactingLogRecordExporter, RedactingSpanExporter } from './sdk/redacting-exporters.ts';
import { createResource } from './sdk/resource.ts';
import { samplerFrom } from './sdk/sampler.ts';
import { boundedMetricViews } from './sdk/views.ts';

/** At most one export error reaches `onExportError` in this window, across all three signals. */
const ERROR_REPORT_INTERVAL_MS = 60_000;

export interface NodeTelemetryOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  /** The OTLP/HTTP base URL; the signal paths `/v1/traces`, `/v1/metrics` and `/v1/logs` are appended. */
  endpoint: string;
  headers?: Record<string, string>;
  /** The sampling ratio as text; the default ratio applies when it is unset or invalid. */
  samplerArg?: string;
  /** The metric export interval in milliseconds. */
  intervalMs: number;
  /** Called with an export failure, at most once a minute. */
  onExportError: (error: unknown) => void;
  /** Milliseconds from an arbitrary origin; defaults to `Date.now`. Injected by tests. */
  now?: () => number;
}

export interface TelemetryHandle {
  readonly tracerProvider: BasicTracerProvider;
  readonly meterProvider: MeterProvider;
  readonly loggerProvider: LoggerProvider;
  /** Flushes every signal and stops the exporters. */
  shutdown(): Promise<void>;
}

/** Passes the export failures of one exporter to the reporter, then hands the result on unchanged. */
class ExportErrorReporter {
  readonly #report: (error: unknown) => void;
  readonly #now: () => number;
  #lastReported = Number.NEGATIVE_INFINITY;

  constructor(report: (error: unknown) => void, now: () => number) {
    this.#report = report;
    this.#now = now;
  }

  observe(result: ExportResult): void {
    if (result.code === ExportResultCode.SUCCESS) return;
    const current = this.#now();
    if (current - this.#lastReported < ERROR_REPORT_INTERVAL_MS) return;
    this.#lastReported = current;
    this.#report(result.error ?? new Error('telemetry export failed'));
  }
}

type OtlpConfig = { url: string; headers?: Record<string, string> };

// Each OTLP exporter reports its failed exports to the reporter and keeps every other behaviour of the library class,
// including the metric temporality selectors of the metric exporter.
class ReportingTraceExporter extends OTLPTraceExporter {
  readonly #reporter: ExportErrorReporter;

  constructor(config: OtlpConfig, reporter: ExportErrorReporter) {
    super(config);
    this.#reporter = reporter;
  }

  override export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    super.export(spans, (result) => {
      this.#reporter.observe(result);
      resultCallback(result);
    });
  }
}

class ReportingMetricExporter extends OTLPMetricExporter {
  readonly #reporter: ExportErrorReporter;

  constructor(config: OtlpConfig, reporter: ExportErrorReporter) {
    super(config);
    this.#reporter = reporter;
  }

  override export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    super.export(metrics, (result) => {
      this.#reporter.observe(result);
      resultCallback(result);
    });
  }
}

class ReportingLogExporter extends OTLPLogExporter {
  readonly #reporter: ExportErrorReporter;

  constructor(config: OtlpConfig, reporter: ExportErrorReporter) {
    super(config);
    this.#reporter = reporter;
  }

  override export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    super.export(logs, (result) => {
      this.#reporter.observe(result);
      resultCallback(result);
    });
  }
}

function signalUrl(endpoint: string, signal: 'traces' | 'metrics' | 'logs'): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

/**
 * Starts the traces, metrics and logs of one process, exported over OTLP/HTTP to `endpoint`. Every exported record
 * passes its redacting exporter first, and the metric views keep only the bounded attribute sets.
 */
export function startNodeTelemetry(options: NodeTelemetryOptions): TelemetryHandle {
  const now = options.now ?? (() => Date.now());
  const resource = createResource({
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
    environment: options.environment,
  });
  const reporter = new ExportErrorReporter(options.onExportError, now);
  const config = (signal: 'traces' | 'metrics' | 'logs'): OtlpConfig => ({
    url: signalUrl(options.endpoint, signal),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });

  const tracerProvider = new BasicTracerProvider({
    resource,
    sampler: samplerFrom(options.samplerArg, now),
    spanProcessors: [
      new BatchSpanProcessor(
        new RedactingSpanExporter(new ReportingTraceExporter(config('traces'), reporter)),
      ),
    ],
  });

  const meterProvider = new MeterProvider({
    resource,
    views: boundedMetricViews(),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new ReportingMetricExporter(config('metrics'), reporter),
        exportIntervalMillis: options.intervalMs,
      }),
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new RedactingLogRecordExporter(new ReportingLogExporter(config('logs'), reporter), now),
      }),
    ],
  });

  return {
    tracerProvider,
    meterProvider,
    loggerProvider,
    // A failed export rejects the provider's shutdown, but it has already reached onExportError; shutdown itself must
    // not throw, because the caller runs it from a signal handler.
    async shutdown(): Promise<void> {
      await Promise.all(
        [tracerProvider.shutdown(), meterProvider.shutdown(), loggerProvider.shutdown()].map((done) =>
          done.catch(() => undefined),
        ),
      );
    },
  };
}
