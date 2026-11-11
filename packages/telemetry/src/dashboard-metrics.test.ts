// Dashboard and code agree (OBS-36). Every metric a dashboard panel queries must be an instrument the code defines. The
// dashboard is read as text: its PromQL is parsed for metric names, and each name must be the Prometheus name of an entry
// of INSTRUMENT_NAMES. The Prometheus names follow the OpenTelemetry-to-Prometheus rule: dots become underscores, the unit
// becomes a suffix (`s` is `seconds`, `By` is `bytes`), a unit-less instrument has no suffix, and a histogram is queried as
// `_bucket`, `_sum` or `_count`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_NAMES } from './instrument-names.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.resolve(
  here,
  '..',
  '..',
  '..',
  'infra',
  'observability',
  'dashboards',
  'skeleton.json',
);

/** The Prometheus name of each instrument, keyed by its OpenTelemetry name (the rule above, written out). */
const PROMETHEUS_NAMES: Record<string, string> = {
  [INSTRUMENT_NAMES.httpServerRequestDuration]: 'http_server_request_duration_seconds',
  [INSTRUMENT_NAMES.httpServerResponseBodySize]: 'http_server_response_body_size_bytes',
  [INSTRUMENT_NAMES.sseConnections]: 'sse_connections',
  [INSTRUMENT_NAMES.outboxLag]: 'outbox_lag_seconds',
  [INSTRUMENT_NAMES.roomStageDuration]: 'room_stage_duration_seconds',
  // A gauge with a curly-brace unit has no suffix; the histogram's unit `s` is `seconds`.
  [INSTRUMENT_NAMES.queueSize]: 'd2r_queue_size',
  [INSTRUMENT_NAMES.queueWait]: 'd2r_queue_wait_seconds',
  // A counter is queried with its `_total` suffix (the OpenTelemetry-to-Prometheus rule for monotonic sums).
  [INSTRUMENT_NAMES.readyCheckResolved]: 'd2r_ready_check_resolved_total',
  [INSTRUMENT_NAMES.roomFinalStage]: 'd2r_room_final_stage_total',
  [INSTRUMENT_NAMES.roomTimeToActive]: 'd2r_room_time_to_active_seconds',
};

/** PromQL words that are functions or keywords, not metric names. */
const PROMQL_WORDS = new Set([
  'rate',
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'increase',
  'histogram_quantile',
  'by',
  'without',
  'on',
  'ignoring',
]);
const HISTOGRAM_SUFFIX = /_(bucket|sum|count)$/u;

/** The metric names one PromQL expression reads: label matchers, ranges and `by (...)` clauses are removed first. */
function metricNamesIn(expr: string): string[] {
  const bare = expr
    .replace(/\{[^}]*\}/gu, ' ')
    .replace(/\[[^\]]*\]/gu, ' ')
    .replace(/\b(?:by|without)\s*\([^)]*\)/gu, ' ');
  return [...bare.matchAll(/\b[a-zA-Z_:][a-zA-Z0-9_:]*\b/gu)]
    .map((match) => match[0])
    .filter((word) => !PROMQL_WORDS.has(word));
}

/** Every metric name the panels of a dashboard query, after the histogram suffix is removed. */
function dashboardMetrics(dashboardJson: string): string[] {
  const dashboard = JSON.parse(dashboardJson) as { panels: { targets?: { expr: string }[] }[] };
  const known = new Set(Object.values(PROMETHEUS_NAMES));
  return dashboard.panels
    .flatMap((panel) => (panel.targets ?? []).flatMap((target) => metricNamesIn(target.expr)))
    .map((name) => (known.has(name) ? name : name.replace(HISTOGRAM_SUFFIX, '')));
}

describe('dashboard metrics against the instrument names', () => {
  it('maps every instrument of INSTRUMENT_NAMES to its Prometheus name', () => {
    expect(Object.keys(PROMETHEUS_NAMES).sort()).toStrictEqual(Object.values(INSTRUMENT_NAMES).sort());
  });

  it('every dashboard metric is defined by the code', () => {
    const queried = dashboardMetrics(readFileSync(dashboardPath, 'utf8'));
    expect(queried.length).toBeGreaterThan(0);

    const known = new Set(Object.values(PROMETHEUS_NAMES));
    const undefinedNames = [...new Set(queried)].filter((name) => !known.has(name));
    expect(undefinedNames).toStrictEqual([]);
  });

  it('a fixture dashboard with an undefined metric is reported', () => {
    const fixture = JSON.stringify({
      panels: [
        {
          targets: [
            { expr: 'sum(rate(http_server_request_duration_seconds_count{service_name="d2rmm-api"}[5m]))' },
            { expr: 'max(room_stage_seconds{service_name="d2rmm-api"})' },
          ],
        },
      ],
    });
    const known = new Set(Object.values(PROMETHEUS_NAMES));
    const undefinedNames = [...new Set(dashboardMetrics(fixture))].filter((name) => !known.has(name));
    expect(undefinedNames).toStrictEqual(['room_stage_seconds']);
  });
});
