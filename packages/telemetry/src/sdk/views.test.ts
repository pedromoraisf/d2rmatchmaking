import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_NAMES } from '../instrument-names.ts';
import { APP_METER_NAME, HTTP_INSTRUMENTATION_METER_NAME, boundedMetricViews } from './views.ts';

// A reader that never exports: the test pulls one snapshot with collect(), so each series appears once. Exporting
// with cumulative temporality repeats every series on every export, which made the collected list hold two copies.
class SnapshotReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

// Records through a provider that uses the bounded views and returns the one collected snapshot.
async function collectWithViews(record: (provider: MeterProvider) => void): Promise<ResourceMetrics[]> {
  const reader = new SnapshotReader();
  const provider = new MeterProvider({ readers: [reader], views: boundedMetricViews() });
  record(provider);
  const { resourceMetrics } = await reader.collect();
  await provider.shutdown();
  return [resourceMetrics];
}

function metricNamed(resources: ResourceMetrics[], name: string) {
  return resources
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name);
}

describe('boundedMetricViews', () => {
  it('metric attributes are limited to the bounded sets', async () => {
    const resources = await collectWithViews((provider) => {
      provider
        .getMeter(APP_METER_NAME)
        .createUpDownCounter(INSTRUMENT_NAMES.sseConnections)
        .add(1, { 'd2r.stream.kind': 'agent', 'd2r.room.id': 'room-secret-1' });
    });

    const [metric] = metricNamed(resources, INSTRUMENT_NAMES.sseConnections);
    expect(metric?.dataPoints.map((point) => point.attributes)).toStrictEqual([
      { 'd2r.stream.kind': 'agent' },
    ]);
  });

  it('drops the HTTP instrumentation duration histogram and keeps the application one by route and status class', async () => {
    const resources = await collectWithViews((provider) => {
      provider
        .getMeter(HTTP_INSTRUMENTATION_METER_NAME)
        .createHistogram(INSTRUMENT_NAMES.httpServerRequestDuration)
        .record(0.02, { 'http.request.method': 'GET', 'http.route': '/v1/lobby/:roomId' });
      provider
        .getMeter(APP_METER_NAME)
        .createHistogram(INSTRUMENT_NAMES.httpServerRequestDuration)
        .record(0.02, {
          'http.route': '/v1/lobby/:roomId',
          'http.response.status_class': '2xx',
          'http.request.method': 'GET',
        });
    });

    const metrics = metricNamed(resources, INSTRUMENT_NAMES.httpServerRequestDuration);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.dataPoints.map((point) => point.attributes)).toStrictEqual([
      { 'http.route': '/v1/lobby/:roomId', 'http.response.status_class': '2xx' },
    ]);
  });
});
