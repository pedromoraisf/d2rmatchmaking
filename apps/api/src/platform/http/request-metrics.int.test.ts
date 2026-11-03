// Request metrics (OBS-33, AD-095): the duration and body size histograms are recorded by route template and status class
// into an in-memory metric reader, so no id from a path reaches an attribute and a hijacked stream records nothing.
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
  type Histogram,
} from '@opentelemetry/sdk-metrics';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { APP_METER_NAME, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import { registerRequestMetrics } from './request-metrics.ts';

const ITEM_ID = 'player-secret-42';

describe('request metrics', () => {
  it('records request duration and body size by route template and status class', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
    const provider = new MeterProvider({ readers: [reader] });
    const app = Fastify();
    registerRequestMetrics(app, provider.getMeter(APP_METER_NAME));
    app.get('/items/:id', async (request) => ({ id: (request.params as { id: string }).id }));
    app.get('/refuse', async (_request, reply) => reply.code(403).send({ error: 'forbidden' }));
    app.get('/stream', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/plain' });
      reply.raw.end('streamed');
    });

    try {
      await app.inject({ method: 'GET', url: `/items/${ITEM_ID}` });
      await app.inject({ method: 'GET', url: '/refuse' });
      await app.inject({ method: 'GET', url: '/stream' });
      await reader.forceFlush();
    } finally {
      await app.close();
      await provider.shutdown();
    }

    const pointsOf = (name: string): DataPoint<Histogram>[] =>
      exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) => metric.dataPoints as DataPoint<Histogram>[]);
    const duration = pointsOf(INSTRUMENT_NAMES.httpServerRequestDuration);
    const bodySize = pointsOf(INSTRUMENT_NAMES.httpServerResponseBodySize);

    const itemOk = { 'http.route': '/items/:id', 'http.response.status_class': '2xx' };
    const refused = { 'http.route': '/refuse', 'http.response.status_class': '4xx' };
    expect(duration.find((point) => matches(point, itemOk))?.value.count).toBe(1);
    expect(duration.find((point) => matches(point, refused))?.value.count).toBe(1);
    expect(bodySize.find((point) => matches(point, itemOk))?.value.count).toBe(1);
    expect(bodySize.find((point) => matches(point, itemOk))?.value.sum).toBeGreaterThan(0);

    // A hijacked stream never reaches the histograms (AD-095).
    expect(duration.some((point) => point.attributes['http.route'] === '/stream')).toBe(false);
    expect(bodySize.some((point) => point.attributes['http.route'] === '/stream')).toBe(false);

    // The id in the path stays out of every attribute of both histograms.
    for (const point of [...duration, ...bodySize]) {
      expect(Object.values(point.attributes)).not.toContain(ITEM_ID);
      expect(Object.keys(point.attributes).sort()).toEqual(
        ['http.response.status_class', 'http.route'].sort(),
      );
    }
  });
});

function matches(point: DataPoint<Histogram>, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => point.attributes[key] === value);
}
