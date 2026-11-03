// Request metrics (OBS-33, AD-095): `http.server.request.duration` (seconds) and `http.server.response.body.size` (bytes)
// by route template and status class. A stream (`reply.hijack()`) records nothing: it never goes through `onSend`, and
// Fastify still runs `onResponse` for it, so the hook skips it there. `sse.connections` covers the streams.
import type { Meter } from '@opentelemetry/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { INSTRUMENT_NAMES } from '@d2rmm/telemetry';

/** The route of a request that matched no route: one fixed value, so an unmatched path never becomes an attribute. */
const UNMATCHED_ROUTE = '(unmatched)';

/** The size of a serialized payload in bytes, or undefined when the payload is a stream (its size is not known here). */
function byteLengthOf(payload: unknown): number | undefined {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload);
  }
  if (Buffer.isBuffer(payload)) {
    return payload.length;
  }
  return undefined;
}

/** Records the two request histograms on `meter`, for every response the app sends through `onSend`. */
export function registerRequestMetrics(app: FastifyInstance, meter: Meter): void {
  const duration = meter.createHistogram(INSTRUMENT_NAMES.httpServerRequestDuration, {
    unit: 's',
    description: 'Duration of an HTTP request served by the API.',
  });
  const bodySize = meter.createHistogram(INSTRUMENT_NAMES.httpServerResponseBodySize, {
    unit: 'By',
    description: 'Size of the body of an HTTP response served by the API.',
  });
  // The body size of each response that went through onSend; undefined for a stream payload, whose size is not known.
  const sent = new WeakMap<FastifyRequest, number | undefined>();

  app.addHook('onSend', async (request, _reply, payload) => {
    sent.set(request, byteLengthOf(payload));
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!sent.has(request)) {
      return;
    }
    const attributes = {
      'http.route': request.routeOptions.url ?? UNMATCHED_ROUTE,
      'http.response.status_class': `${Math.floor(reply.statusCode / 100)}xx`,
    };
    duration.record(reply.elapsedTime / 1000, attributes);
    const size = sent.get(request);
    if (size !== undefined) {
      bodySize.record(size, attributes);
    }
  });
}
