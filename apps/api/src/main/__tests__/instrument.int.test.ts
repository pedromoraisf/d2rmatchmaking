// The preload (OBS-01, OBS-03) against a fake OTLP/HTTP backend: local.ts is started as a child process with
// `--import ./src/main/instrument.ts`, the endpoint set, and its traces and metrics are read back from the backend.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/support/postgres.ts';

/** The API package root: the composition roots and the preload are run from here. */
const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PRELOAD = path.join(API_ROOT, 'src/main/instrument.ts');
const LOCAL_ROOT = path.join(API_ROOT, 'src/main/local.ts');
const SECRET = `secret-${randomBytes(12).toString('hex')}`;
/** A route that runs one parameterised statement: `select … where event_type = $1` (test controls, acceptance only). */
const DB_ROUTE = '/__test/redeliver-match-formed';
const SPAN_KIND_SERVER = 2;
const SPAN_KIND_CLIENT = 3;

interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue?: string; readonly intValue?: string | number };
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number | string;
  readonly attributes?: readonly OtlpAttribute[];
}

/** Everything the fake backend received, per signal path. */
interface Received {
  readonly path: string;
  readonly body: unknown;
}

interface Captured {
  readonly spans: readonly OtlpSpan[];
  readonly metricNames: readonly string[];
  readonly serviceNames: readonly string[];
  /** The trace id of every exported log record. */
  readonly logTraceIds: readonly string[];
}

let database: TestDatabase;
let backend: Server;
let backendUrl: string;
const received: Received[] = [];
const children: ChildProcess[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  backend = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      received.push({ path: request.url ?? '', body: text.length === 0 ? undefined : JSON.parse(text) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  backend.close();
  await database.close();
});

/** A fresh database named `acc_w<n>`, as the acceptance stack creates one per worker (the test routes require it). */
async function createAcceptanceDatabase(): Promise<string> {
  const name = `acc_w${randomInt(1_000_000_000)}`;
  const admin = new pg.Client({ connectionString: inject('postgresAdminUrl') });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(database.url);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Starts local.ts with the preload and the endpoint set; resolves with its loopback address once it listens. */
async function startInstrumentedLocal(): Promise<{ url: string; child: ChildProcess }> {
  const databaseUrl = await createAcceptanceDatabase();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, LOCAL_ROOT], {
      cwd: API_ROOT,
      env: {
        PATH: process.env['PATH'] ?? '',
        DATABASE_URL: databaseUrl,
        D2RMM_ENV: 'local',
        PORT: '0',
        D2RMM_ACCEPTANCE: 'true',
        TEST_CONTROL_SECRET: SECRET,
        OTEL_EXPORTER_OTLP_ENDPOINT: backendUrl,
        OTEL_TRACES_SAMPLER_ARG: '1',
        OTEL_METRIC_EXPORT_INTERVAL: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`local.ts did not listen in time: ${stderr}`));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        resolve({ url, child });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`local.ts exited with ${String(code)}: ${stderr}`));
    });
  });
}

/** Flattens the OTLP JSON the backend received for one signal path. */
function receivedFor(signalPath: string): unknown[] {
  return received.filter((item) => item.path === signalPath).map((item) => item.body);
}

function spansOf(bodies: unknown[]): OtlpSpan[] {
  const spans: OtlpSpan[] = [];
  for (const body of bodies as { resourceSpans?: { scopeSpans?: { spans?: OtlpSpan[] }[] }[] }[]) {
    for (const resource of body.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) {
        spans.push(...(scope.spans ?? []));
      }
    }
  }
  return spans;
}

function metricNamesOf(bodies: unknown[]): string[] {
  const names: string[] = [];
  for (const body of bodies as {
    resourceMetrics?: { scopeMetrics?: { metrics?: { name: string }[] }[] }[];
  }[]) {
    for (const resource of body.resourceMetrics ?? []) {
      for (const scope of resource.scopeMetrics ?? []) {
        names.push(...(scope.metrics ?? []).map((metric) => metric.name));
      }
    }
  }
  return names;
}

function logTraceIdsOf(bodies: unknown[]): string[] {
  const ids: string[] = [];
  for (const body of bodies as {
    resourceLogs?: { scopeLogs?: { logRecords?: { traceId?: string }[] }[] }[];
  }[]) {
    for (const resource of body.resourceLogs ?? []) {
      for (const scope of resource.scopeLogs ?? []) {
        for (const record of scope.logRecords ?? []) {
          if (record.traceId !== undefined && record.traceId !== '') {
            ids.push(record.traceId);
          }
        }
      }
    }
  }
  return ids;
}

function serviceNamesOf(bodies: unknown[]): string[] {
  const names: string[] = [];
  for (const body of bodies as { resourceSpans?: { resource?: { attributes?: OtlpAttribute[] } }[] }[]) {
    for (const resource of body.resourceSpans ?? []) {
      for (const attribute of resource.resource?.attributes ?? []) {
        if (attribute.key === 'service.name') {
          names.push(attribute.value.stringValue ?? '');
        }
      }
    }
  }
  return names;
}

/**
 * The HTTP server span of a request to `urlPath`. Selected by kind and `url.path`: without a route template the span is
 * named by its method only, so its name cannot identify the request.
 */
function isServerSpanFor(urlPath: string): (span: OtlpSpan) => boolean {
  return (span) =>
    (span.kind === SPAN_KIND_SERVER || span.kind === 'SPAN_KIND_SERVER') &&
    attributeOf(span, 'url.path') === urlPath;
}

function attributeOf(span: OtlpSpan, key: string): string | number | undefined {
  const found = span.attributes?.find((attribute) => attribute.key === key);
  return found?.value.stringValue ?? found?.value.intValue;
}

function isPostgresClient(span: OtlpSpan): boolean {
  const client = span.kind === SPAN_KIND_CLIENT || span.kind === 'SPAN_KIND_CLIENT';
  return (
    client &&
    (attributeOf(span, 'db.system.name') === 'postgresql' || attributeOf(span, 'db.system') === 'postgresql')
  );
}

/** The statement a pg span carries (`db.query.text`), or undefined for a span that runs no statement (a connect). */
function statementOf(span: OtlpSpan): string | undefined {
  const value = attributeOf(span, 'db.query.text') ?? attributeOf(span, 'db.statement');
  return value === undefined ? undefined : String(value);
}

/** A postgresql span that runs a statement as a direct child of `server`. */
function isStatementChildOf(server: OtlpSpan): (span: OtlpSpan) => boolean {
  return (span) =>
    span.parentSpanId === server.spanId && isPostgresClient(span) && statementOf(span) !== undefined;
}

/** Polls until the backend holds what `ready` asks for, or fails after `timeoutMs`. */
async function waitForBackend(ready: () => boolean, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error('the fake OTLP backend did not receive the expected export in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

let captured: Promise<Captured> | undefined;

/**
 * Runs the instrumented API once for the file: a health check (which must not be traced as a server span), one
 * database-backed request, then waits for the exports of traces and metrics.
 */
function runInstrumentedApi(): Promise<Captured> {
  captured ??= (async () => {
    const { url } = await startInstrumentedLocal();
    const health = await fetch(`${url}/healthz`);
    expect(health.status).toBe(200);
    const dbRequest = await fetch(`${url}${DB_ROUTE}`, {
      method: 'POST',
      headers: { 'x-test-control': SECRET },
    });
    expect(dbRequest.status).toBe(404);
    await waitForBackend(() => {
      const spans = spansOf(receivedFor('/v1/traces'));
      const server = spans.find(isServerSpanFor(DB_ROUTE));
      return (
        server !== undefined &&
        spans.some(isStatementChildOf(server)) &&
        metricNamesOf(receivedFor('/v1/metrics')).length > 0 &&
        logTraceIdsOf(receivedFor('/v1/logs')).includes(server.traceId)
      );
    });
    const traces = receivedFor('/v1/traces');
    return {
      spans: spansOf(traces),
      metricNames: metricNamesOf(receivedFor('/v1/metrics')),
      serviceNames: serviceNamesOf(traces),
      logTraceIds: logTraceIdsOf(receivedFor('/v1/logs')),
    };
  })();
  return captured;
}

describe('the API preload', () => {
  it('exports traces and metrics to the configured endpoint', async () => {
    const result = await runInstrumentedApi();

    const server = result.spans.find(isServerSpanFor(DB_ROUTE));
    expect(server).toBeDefined();
    expect(server?.kind === SPAN_KIND_SERVER || server?.kind === 'SPAN_KIND_SERVER').toBe(true);
    expect(result.spans.some(isServerSpanFor('/healthz'))).toBe(false);
    expect(result.metricNames.length).toBeGreaterThan(0);
    expect(result.serviceNames).toContain('d2rmm-api');
  });

  it('exports a log record with the trace id', async () => {
    const result = await runInstrumentedApi();

    const server = result.spans.find(isServerSpanFor(DB_ROUTE));
    expect(server).toBeDefined();
    expect(result.logTraceIds).toContain(server?.traceId);
  });

  it('pg span names the statement without parameter values and is a child of the server span', async () => {
    const result = await runInstrumentedApi();

    const server = result.spans.find(isServerSpanFor(DB_ROUTE));
    expect(server).toBeDefined();
    if (server === undefined) {
      throw new Error('no server span for the database route');
    }
    const dbSpan = result.spans.find(isStatementChildOf(server));
    expect(dbSpan).toBeDefined();
    if (dbSpan === undefined) {
      throw new Error('no postgresql span under the server span');
    }
    const statement = statementOf(dbSpan) ?? '';
    expect(statement).toContain('$1');
    expect(statement).not.toContain('MatchFormed');
    expect(dbSpan.traceId).toBe(server.traceId);
    expect(dbSpan.parentSpanId).toBe(server.spanId);
  });
});
