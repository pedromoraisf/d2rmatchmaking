// Exporters that redact every record before it reaches the inner exporter (OBS-26, OBS-27, OBS-28). Each record is
// copied, never mutated: the ended span or log record the SDK still holds keeps its values.
import type { Attributes, Link } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan, SpanExporter, TimedEvent } from '@opentelemetry/sdk-trace-base';
import { redactAttributes, scrubText } from '../redact-attributes.ts';

type LogAttributes = ReadableLogRecord['attributes'];

// Span events keep the exception type; the message and the stack hold row values and paths.
const EXCEPTION_DROPPED_KEYS: ReadonlySet<string> = new Set(['exception.message', 'exception.stacktrace']);

// Log attributes that may leave the process; req.url, err and error.* never do.
const LOG_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'level',
  'time',
  'msg',
  'trace_id',
  'span_id',
  'reqId',
  'req.method',
  'res.statusCode',
  'responseTime',
]);

// Severity WARN and above (OpenTelemetry SeverityNumber 13 to 24); lower records pass only when their span is sampled.
const WARN_SEVERITY_NUMBER = 13;
const LOG_CAP_PER_SECOND = 20;
const TRACE_FLAG_SAMPLED = 0x01;

function isKeptResourceKey(key: string): boolean {
  return (
    key.startsWith('service.') ||
    key === 'deployment.environment' ||
    key === 'd2r.agent.version' ||
    key.startsWith('telemetry.sdk.')
  );
}

function isAllowedLogKey(key: string): boolean {
  return LOG_ATTRIBUTE_KEYS.has(key) || key.startsWith('d2r.');
}

function redactEvent(event: TimedEvent): TimedEvent {
  if (event.attributes === undefined) return event;
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(redactAttributes(event.attributes))) {
    if (!EXCEPTION_DROPPED_KEYS.has(key)) attributes[key] = value;
  }
  return { ...event, attributes };
}

function redactLink(link: Link): Link {
  if (link.attributes === undefined) return link;
  return { ...link, attributes: redactAttributes(link.attributes) };
}

function keptResource(resource: Resource): Resource {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(resource.attributes)) {
    if (isKeptResourceKey(key)) kept[key] = value;
  }
  return resourceFromAttributes(kept);
}

/** A copy of an ended span that keeps the SDK's methods through the prototype chain and carries redacted fields. */
function redactedSpan(span: ReadableSpan): ReadableSpan {
  return Object.assign(Object.create(span) as ReadableSpan, {
    attributes: redactAttributes(span.attributes),
    events: span.events.map(redactEvent),
    links: span.links.map(redactLink),
    status: { code: span.status.code },
    resource: keptResource(span.resource),
  });
}

/** Redacts spans before the inner exporter sees them. */
export class RedactingSpanExporter implements SpanExporter {
  readonly #inner: SpanExporter;

  constructor(inner: SpanExporter) {
    this.#inner = inner;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.#inner.export(spans.map(redactedSpan), resultCallback);
  }

  async shutdown(): Promise<void> {
    await this.#inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.#inner.forceFlush?.();
  }
}

function allowedLogAttributes(attributes: LogAttributes): LogAttributes {
  const kept: LogAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isAllowedLogKey(key)) kept[key] = value;
  }
  return kept;
}

function isSampledRecord(record: ReadableLogRecord): boolean {
  return ((record.spanContext?.traceFlags ?? 0) & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED;
}

function redactedLog(record: ReadableLogRecord): ReadableLogRecord {
  const body = typeof record.body === 'string' ? scrubText(record.body) : record.body;
  return {
    hrTime: record.hrTime,
    hrTimeObserved: record.hrTimeObserved,
    resource: record.resource,
    instrumentationScope: record.instrumentationScope,
    attributes: allowedLogAttributes(record.attributes),
    droppedAttributesCount: record.droppedAttributesCount,
    ...(record.spanContext === undefined ? {} : { spanContext: record.spanContext }),
    ...(record.severityText === undefined ? {} : { severityText: record.severityText }),
    ...(record.severityNumber === undefined ? {} : { severityNumber: record.severityNumber }),
    ...(record.eventName === undefined ? {} : { eventName: record.eventName }),
    ...(body === undefined ? {} : { body }),
  };
}

/**
 * Redacts log records and limits their volume. A record passes when it is WARN or above or belongs to a sampled span;
 * at most LOG_CAP_PER_SECOND records leave in each one-second window.
 */
export class RedactingLogRecordExporter implements LogRecordExporter {
  readonly #inner: LogRecordExporter;
  readonly #now: () => number;
  #windowStart = Number.NEGATIVE_INFINITY;
  #exportedInWindow = 0;

  constructor(inner: LogRecordExporter, now: () => number = () => Date.now()) {
    this.#inner = inner;
    this.#now = now;
  }

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    const admitted = logs.filter(
      (record) => (record.severityNumber ?? 0) >= WARN_SEVERITY_NUMBER || isSampledRecord(record),
    );
    const kept = admitted.filter((): boolean => this.#admitOne()).map(redactedLog);
    if (kept.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.#inner.export(kept, resultCallback);
  }

  async shutdown(): Promise<void> {
    await this.#inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.#inner.forceFlush();
  }

  #admitOne(): boolean {
    const current = this.#now();
    if (current - this.#windowStart >= 1000 || current < this.#windowStart) {
      this.#windowStart = current;
      this.#exportedInWindow = 0;
    }
    if (this.#exportedInWindow >= LOG_CAP_PER_SECOND) return false;
    this.#exportedInWindow += 1;
    return true;
  }
}
