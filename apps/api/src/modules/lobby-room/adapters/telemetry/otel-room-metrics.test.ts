// Room metrics adapter (OBS-34): the histogram is created on the application meter and records only bounded attributes.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
  type Histogram,
} from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { APP_METER_NAME, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import { OtelRoomMetrics } from './otel-room-metrics.ts';

function collectScopes(exporter: InMemoryMetricExporter) {
  return exporter.getMetrics().flatMap((resource) => resource.scopeMetrics);
}

describe('OtelRoomMetrics', () => {
  it('the adapter records the histogram with bounded attributes', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    const provider = new MeterProvider({ readers: [reader] });
    const metrics = new OtelRoomMetrics(provider.getMeter(APP_METER_NAME));

    let scopes: ReturnType<typeof collectScopes> = [];
    try {
      metrics.stageLeft('awaiting_host', 'hell', 'leveling', 90);
      await reader.forceFlush();
      // Read before shutdown: shutdown runs one more export, which would repeat the scope in the in-memory exporter.
      scopes = collectScopes(exporter);
    } finally {
      await provider.shutdown();
    }

    expect(scopes.map((scope) => scope.scope.name)).toEqual([APP_METER_NAME]);
    const metric = scopes
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === INSTRUMENT_NAMES.roomStageDuration);
    expect(metric?.descriptor.unit).toBe('s');
    const points = (metric?.dataPoints ?? []) as DataPoint<Histogram>[];
    expect(points).toHaveLength(1);
    expect(points[0]?.attributes).toEqual({
      'd2r.room.stage': 'awaiting_host',
      'd2r.difficulty': 'hell',
      'd2r.queue.mode': 'leveling',
    });
    expect(points[0]?.value.sum).toBe(90);
  });

  it('counts a room by its final stage and records the time to active, with bounded attributes', async () => {
    const reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 60_000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    const metrics = new OtelRoomMetrics(provider.getMeter(APP_METER_NAME));

    metrics.finalStage('expired', 'hell', 'pvp');
    metrics.finalStage('expired', 'hell', 'pvp');
    metrics.timeToActive('hell', 'pvp', 42);
    const collected = await reader.collect();
    await provider.shutdown();

    const byName = (name: string) =>
      collected.resourceMetrics.scopeMetrics
        .flatMap((scope) => scope.metrics)
        .find((candidate) => candidate.descriptor.name === name);
    const counter = byName(INSTRUMENT_NAMES.roomFinalStage);
    expect(counter?.dataPoints.map((point) => [point.attributes, point.value])).toEqual([
      [{ 'd2r.room.stage': 'expired', 'd2r.difficulty': 'hell', 'd2r.queue.mode': 'pvp' }, 2],
    ]);
    const histogram = byName(INSTRUMENT_NAMES.roomTimeToActive);
    expect(histogram?.descriptor.unit).toBe('s');
    const points = (histogram?.dataPoints ?? []) as DataPoint<Histogram>[];
    expect(points.map((point) => [point.attributes, point.value.sum])).toEqual([
      [{ 'd2r.difficulty': 'hell', 'd2r.queue.mode': 'pvp' }, 42],
    ]);
  });
});
