// The queue metrics (QUE-16): bounded attributes only, read through a non-exporting reader.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
  type Histogram,
} from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { APP_METER_NAME } from '@d2rmm/telemetry';
import {
  OtelQueueMetrics,
  QUEUE_SIZE_METRIC,
  QUEUE_WAIT_METRIC,
  READY_CHECK_RESOLVED_METRIC,
} from './otel-queue-metrics.ts';

const POOL = {
  mode: 'pvp' as const,
  difficulty: 'hell' as const,
  ladder: 'sc-ladder' as const,
  era: 'rotw' as const,
};

async function collectMetrics(record: (metrics: OtelQueueMetrics) => void) {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const metrics = new OtelQueueMetrics(provider.getMeter(APP_METER_NAME));
  let scopes: ReturnType<InMemoryMetricExporter['getMetrics']> = [];
  try {
    record(metrics);
    await reader.forceFlush();
    scopes = exporter.getMetrics();
  } finally {
    await provider.shutdown();
  }
  return scopes.flatMap((resource) => resource.scopeMetrics).flatMap((scope) => scope.metrics);
}

describe('OtelQueueMetrics', () => {
  it('reports the wait at match as a histogram in seconds with the pool attributes', async () => {
    const metrics = await collectMetrics((queue) => queue.waitAtMatch(POOL, 65));

    const wait = metrics.find((metric) => metric.descriptor.name === QUEUE_WAIT_METRIC);
    expect(wait?.descriptor.unit).toBe('s');
    const points = (wait?.dataPoints ?? []) as DataPoint<Histogram>[];
    expect(points).toHaveLength(1);
    expect(points[0]?.attributes).toStrictEqual({
      'd2r.queue.mode': 'pvp',
      'd2r.difficulty': 'hell',
      'd2r.ladder': 'sc-ladder',
      'd2r.era': 'rotw',
    });
    expect(points[0]?.value.sum).toBe(65);
  });

  it('reports the latest size of each pool as a gauge', async () => {
    const metrics = await collectMetrics((queue) => {
      queue.queueSize(POOL, 3);
      queue.queueSize(POOL, 1);
    });

    const size = metrics.find((metric) => metric.descriptor.name === QUEUE_SIZE_METRIC);
    expect(size).toBeDefined();
    const values = (size?.dataPoints ?? []).map((point) => point.value);
    expect(values).toStrictEqual([1]);
  });

  it('records nothing but the four bounded keys: no account or character name', async () => {
    const metrics = await collectMetrics((queue) => queue.waitAtMatch(POOL, 5));

    const keys = metrics.flatMap((metric) =>
      (metric.dataPoints as DataPoint<Histogram>[]).flatMap((point) => Object.keys(point.attributes)),
    );
    expect([...new Set(keys)].sort()).toStrictEqual([
      'd2r.difficulty',
      'd2r.era',
      'd2r.ladder',
      'd2r.queue.mode',
    ]);
  });

  it('counts the ready checks that ended, by outcome, with no name (RDY-10)', async () => {
    const metrics = await collectMetrics((queue) => {
      queue.readyCheckResolved('accepted');
      queue.readyCheckResolved('timed-out');
      queue.readyCheckResolved('timed-out');
    });

    const resolved = metrics.find((metric) => metric.descriptor.name === READY_CHECK_RESOLVED_METRIC);
    expect(resolved?.descriptor.unit).toBe('{check}');
    const points = (resolved?.dataPoints ?? []) as DataPoint<number>[];
    const counts = points.map((point) => [point.attributes['d2r.ready_check.outcome'], point.value]);
    expect(counts).toStrictEqual([
      ['accepted', 1],
      ['timed-out', 2],
    ]);
  });
});
