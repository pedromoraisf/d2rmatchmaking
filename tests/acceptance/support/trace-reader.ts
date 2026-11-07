// The trace scenarios read their traces back from the telemetry backend (OBS-24), check the edges of OBS-08 and OBS-12,
// and scan everything the stack exported for leaks (OBS-28 to OBS-30). The parsing, the edge checks and the scan are pure;
// the functions that fetch are the only I/O.
import { isDroppedKey } from './forbidden-keys.ts';

const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
/** The longest one request may take. Every request also ends at the poll's deadline, so one slow answer cannot eat the window. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The span names of the trace edges (apps/api, apps/web and apps/agent). */
export const NAMES = {
  siteAction: 'web.action.start-test-match',
  siteRequestPrefix: 'HTTP POST ',
  apiRequest: 'POST',
  agentObservation: 'agent.observation.post',
  agentHttpObservation: 'agent.http.observation',
  relay: 'platform.outbox.relay',
  deliver: 'platform.stream.deliver',
} as const;

/** The attributes that carry a URL, whose query string and fragment must not be exported. */
const URL_KEYS: ReadonlySet<string> = new Set(['url.full', 'http.url', 'http.target', 'url.query']);

/** A span link: the trace id and span id of the span the link points at (RTL-03, RTL-09). */
export interface SpanLinkRecord {
  readonly traceId: string;
  readonly spanId: string;
}

export interface SpanRecord {
  readonly kind: 'span';
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** The span's links as the backend answered them; absent or empty when the span has none. */
  readonly links?: readonly SpanLinkRecord[];
}

export interface MetricRecord {
  readonly kind: 'metric';
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface LogRecord {
  readonly kind: 'log';
  readonly line: string;
}

export type ExportedRecord = SpanRecord | MetricRecord | LogRecord;

export interface Trace {
  readonly traceId: string;
  readonly spans: readonly SpanRecord[];
}

type OtlpValue = {
  stringValue?: string;
  intValue?: string | number;
  boolValue?: boolean;
  doubleValue?: number;
};
interface OtlpSpanJson {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  attributes?: { key: string; value?: OtlpValue }[];
  links?: { traceId?: string; spanId?: string }[];
}
interface OtlpScopeJson {
  spans?: OtlpSpanJson[];
}
interface OtlpResourceJson {
  scopeSpans?: OtlpScopeJson[];
  instrumentationLibrarySpans?: OtlpScopeJson[];
}

/** Tempo's JSON carries ids as hex or as base64 (the protobuf JSON mapping). Both are read as lowercase hex. */
function hexId(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  return /^[0-9a-f]+$/u.test(value) && value.length % 2 === 0
    ? value
    : Buffer.from(value, 'base64').toString('hex');
}

function valueOf(value: OtlpValue | undefined): unknown {
  if (value === undefined) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.boolValue !== undefined) return value.boolValue;
  return value.doubleValue;
}

/** The spans of a Tempo trace answer. Tempo's v1 API answers `batches`; OTLP JSON answers `resourceSpans`; both are read. */
export function spansOfTempo(body: unknown): SpanRecord[] {
  const answer = (body ?? {}) as {
    batches?: OtlpResourceJson[];
    resourceSpans?: OtlpResourceJson[];
    trace?: { resourceSpans?: OtlpResourceJson[] };
  };
  const resources = answer.batches ?? answer.resourceSpans ?? answer.trace?.resourceSpans ?? [];
  const records: SpanRecord[] = [];
  for (const resource of resources) {
    for (const scope of [...(resource.scopeSpans ?? []), ...(resource.instrumentationLibrarySpans ?? [])]) {
      for (const span of scope.spans ?? []) {
        records.push({
          kind: 'span',
          traceId: hexId(span.traceId),
          spanId: hexId(span.spanId),
          parentSpanId: hexId(span.parentSpanId),
          name: span.name ?? '',
          attributes: Object.fromEntries(
            (span.attributes ?? []).map((item) => [item.key, valueOf(item.value)]),
          ),
          links: (span.links ?? []).map((link) => ({
            traceId: hexId(link.traceId),
            spanId: hexId(link.spanId),
          })),
        });
      }
    }
  }
  return records;
}

/**
 * The signal of one request made at `deadline`: it ends after REQUEST_TIMEOUT_MS, or at the deadline when that comes first.
 */
export function boundedSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())));
}

/**
 * The error text a failure message shows: the error's message, and the code and message of its cause when it has one
 * (a `fetch failed` names its cause, such as `ECONNREFUSED`, only there).
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause : undefined;
  if (cause === undefined) return error.message;
  const code = (cause as { code?: unknown }).code;
  return `${error.message} (${cause.message}${typeof code === 'string' ? `, ${code}` : ''})`;
}

/**
 * Polls Tempo for the trace of `traceId` until `ready` holds or 30 s pass, one request at a time. The default is any span
 * of the trace. The scenario passes its edge check, because the spans of a trace reach the backend in batches. The trace is
 * read by its id, which the backend answers as soon as the spans are ingested; its search index lags behind the ingest.
 */
export async function readTrace(
  queryUrl: string,
  traceId: string,
  ready: (trace: Trace) => boolean = (trace) => trace.spans.length > 0,
): Promise<Trace> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = 'no answer yet';
  let partial: Trace | undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${queryUrl}/api/traces/${traceId}`, {
        headers: { Accept: 'application/json' },
        signal: boundedSignal(deadline),
      });
      if (response.ok) {
        const spans = spansOfTempo(await response.json()).filter((span) => span.traceId === traceId);
        partial = { traceId, spans };
        if (spans.length > 0 && ready(partial)) return partial;
        last = `${spans.length} spans so far`;
      } else {
        last = `status ${response.status}`;
      }
    } catch (error) {
      last = describeError(error);
    }
    const left = deadline - Date.now();
    if (left <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, left)));
  }
  const shape =
    partial === undefined
      ? 'none fetched'
      : `${partial.spans.length} spans, span<parent: ${outlineOf(partial)}`;
  throw new Error(
    `trace ${traceId} did not reach the expected shape within 30 s: last ${last}; the trace holds ${shape}`,
  );
}

/** The spans of a trace as `name<parent name` pairs, for a failure message: a missing edge shows as `missing`. */
function outlineOf(trace: Trace): string {
  const byId = new Map(trace.spans.map((span) => [span.spanId, span]));
  return trace.spans
    .map((span) => {
      const parent = span.parentSpanId === '' ? 'root' : (byId.get(span.parentSpanId)?.name ?? 'missing');
      return `${span.name}<${parent}`;
    })
    .join('; ');
}

/** The trace ids that the spans named `name` of a trace link to, in the order the trace holds them (RTL-09). */
export function linkedTraceIds(trace: Trace, name: string): string[] {
  return trace.spans
    .filter((span) => span.name === name)
    .flatMap((span) => (span.links ?? []).map((link) => link.traceId));
}

/** The edges of a trace as `parent -> child` names, for a failure message and for the scenario's log. */
export function parentEdges(trace: Trace): string[] {
  const byId = new Map(trace.spans.map((span) => [span.spanId, span]));
  return trace.spans.flatMap((span) => {
    const parent = byId.get(span.parentSpanId);
    return parent === undefined ? [] : [`${parent.name} -> ${span.name}`];
  });
}

/** A span with no parent in the trace: its parent id is empty, or the parent is not one of the trace's spans. */
function isTop(trace: Trace, span: SpanRecord): boolean {
  return span.parentSpanId === '' || !trace.spans.some((other) => other.spanId === span.parentSpanId);
}

/** True when `span` is below `ancestor` in the parent chain of the trace. */
function isBelow(trace: Trace, span: SpanRecord, ancestor: SpanRecord): boolean {
  const byId = new Map(trace.spans.map((other) => [other.spanId, other]));
  let parentId = span.parentSpanId;
  for (let depth = 0; depth < trace.spans.length && parentId !== ''; depth += 1) {
    if (parentId === ancestor.spanId) return true;
    parentId = byId.get(parentId)?.parentSpanId ?? '';
  }
  return false;
}

function requireOne(trace: Trace, what: string, matches: (span: SpanRecord) => boolean): SpanRecord {
  const found = trace.spans.find(matches);
  if (found === undefined) {
    const names = trace.spans.map((span) => span.name).join(', ');
    throw new Error(`the trace has no ${what}; it holds: ${names}`);
  }
  return found;
}

/**
 * The outbox relay below the request, and the stream delivery as the child of one of those relays. A request can publish
 * several events, each through its own relay span: the delivery is checked under any of them, not only the first.
 */
function requireDelivery(trace: Trace, request: SpanRecord): void {
  const relays = trace.spans.filter((span) => span.name === NAMES.relay && isBelow(trace, span, request));
  requireOne(trace, `${NAMES.relay} below the API request`, () => relays.length > 0);
  requireOne(
    trace,
    `${NAMES.deliver} as a child of a relay below the API request`,
    (span) => span.name === NAMES.deliver && relays.some((relay) => relay.spanId === span.parentSpanId),
  );
}

function isDbQuery(span: SpanRecord): boolean {
  const system = span.attributes['db.system.name'] ?? span.attributes['db.system'];
  return system === 'postgresql' && ('db.query.text' in span.attributes || 'db.statement' in span.attributes);
}

/**
 * OBS-08: the site action is the root; the API request is below the site's request span; a database query is below the
 * request; the outbox relay is below the request (its stored context); the stream delivery is the relay's child.
 */
export function assertTraceA(trace: Trace): void {
  const action = requireOne(
    trace,
    `root span ${NAMES.siteAction}`,
    (span) => span.name === NAMES.siteAction && isTop(trace, span),
  );
  const siteRequest = requireOne(
    trace,
    `site request span of ${NAMES.siteAction}`,
    (span) => span.parentSpanId === action.spanId && span.name.startsWith(NAMES.siteRequestPrefix),
  );
  const request = requireOne(
    trace,
    `API request span below the site request`,
    (span) => span.parentSpanId === siteRequest.spanId && span.name === NAMES.apiRequest,
  );
  requireOne(
    trace,
    'database query below the API request',
    (span) => isDbQuery(span) && isBelow(trace, span, request),
  );
  requireDelivery(trace, request);
}

/**
 * OBS-12: the agent's observation is the root; the API span of its request is the child of that span; the outbox relay is
 * below the request; the stream delivery is the relay's child.
 */
export function assertTraceB(trace: Trace): void {
  const observation = requireOne(
    trace,
    `root span ${NAMES.agentObservation}`,
    (span) => span.name === NAMES.agentObservation && isTop(trace, span),
  );
  // The agent's HTTP span of the observation call sits between the observation and the API request.
  const call = requireOne(
    trace,
    `${NAMES.agentHttpObservation} as the child of ${NAMES.agentObservation}`,
    (span) => span.parentSpanId === observation.spanId && span.name === NAMES.agentHttpObservation,
  );
  const request = requireOne(
    trace,
    `API request span as the child of ${NAMES.agentHttpObservation}`,
    (span) => span.parentSpanId === call.spanId && span.name === NAMES.apiRequest,
  );
  requireDelivery(trace, request);
}

const QUERY_OR_FRAGMENT = /[?#]/u;

function leaksInValue(where: string, key: string, value: unknown, player: string): string[] {
  const found: string[] = [];
  if (isDroppedKey(key)) found.push(`${where} carries the forbidden key ${key}`);
  if (typeof value === 'string') {
    if (URL_KEYS.has(key.toLowerCase()) && QUERY_OR_FRAGMENT.test(value)) {
      found.push(`${where} carries a query string or fragment in ${key}`);
    }
    if (value.includes(player)) found.push(`${where} carries the player name in ${key}`);
  }
  return found;
}

/** The leaks of a parsed JSON log line: a forbidden key at any depth, a URL with a query, or the player name. */
function leaksInJson(where: string, value: unknown, player: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => leaksInJson(where, item, player));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'object' && item !== null
      ? [
          ...(isDroppedKey(key) ? [`${where} carries the forbidden key ${key}`] : []),
          ...leaksInJson(where, item, player),
        ]
      : leaksInValue(where, key, item, player),
  );
}

/**
 * Every leak in what the stack exported: a dropped key, a query string or fragment in a URL attribute, or the player's name
 * in any value or log line. An empty list passes.
 */
export function leaksIn(records: readonly ExportedRecord[], player: string): string[] {
  return records.flatMap((record) => {
    if (record.kind === 'span') {
      const where = `span ${record.name}`;
      const nameLeak = record.name.includes(player) ? [`${where} carries the player name in its name`] : [];
      return [
        ...nameLeak,
        ...Object.entries(record.attributes).flatMap(([key, value]) =>
          leaksInValue(where, key, value, player),
        ),
      ];
    }
    if (record.kind === 'metric') {
      const where = `metric ${record.name}`;
      return Object.entries(record.labels).flatMap(([key, value]) => leaksInValue(where, key, value, player));
    }
    const plain = record.line.includes(player) ? ['a log line carries the player name'] : [];
    try {
      return [...plain, ...leaksInJson('log line', JSON.parse(record.line) as unknown, player)];
    } catch {
      return plain;
    }
  });
}

const METRIC_QUERY =
  '{__name__=~"http_server_.*|outbox_lag_seconds|sse_connections|room_stage_duration_seconds_.*"}';
const LOG_QUERY = '{service_name="d2rmm-api"}';

/** The metric series of the API, read through Grafana's Prometheus datasource proxy (anonymous admin in the image). */
export async function readMetricRecords(grafanaUrl: string): Promise<MetricRecord[]> {
  const url = new URL('/api/datasources/proxy/uid/prometheus/api/v1/query', grafanaUrl);
  url.searchParams.set('query', METRIC_QUERY);
  const answer = (await (
    await fetch(url, { signal: boundedSignal(Date.now() + REQUEST_TIMEOUT_MS) })
  ).json()) as {
    data?: { result?: { metric?: Record<string, string> }[] };
  };
  return (answer.data?.result ?? []).map((series): MetricRecord => {
    const { __name__: name = '', ...labels } = series.metric ?? {};
    return { kind: 'metric', name, labels };
  });
}

/** The log lines of the API, read through Grafana's Loki datasource proxy over the default range. */
export async function readLogRecords(grafanaUrl: string): Promise<LogRecord[]> {
  const url = new URL('/api/datasources/proxy/uid/loki/loki/api/v1/query_range', grafanaUrl);
  url.searchParams.set('query', LOG_QUERY);
  url.searchParams.set('limit', '5000');
  const answer = (await (
    await fetch(url, { signal: boundedSignal(Date.now() + REQUEST_TIMEOUT_MS) })
  ).json()) as {
    data?: { result?: { values?: [string, string][] }[] };
  };
  return (answer.data?.result ?? []).flatMap((stream) =>
    (stream.values ?? []).map(([, line]): LogRecord => ({ kind: 'log', line })),
  );
}

/** Prints the two trace ids the scenarios check, so a failing run names the traces to look at (OBS-24). */
export function printTraceIds(
  ids: { readonly traceA: string; readonly traceB: string },
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): void {
  write(`trace A, the site action (OBS-08): ${ids.traceA}`);
  write(`trace B, the agent observation (OBS-12): ${ids.traceB}`);
}
