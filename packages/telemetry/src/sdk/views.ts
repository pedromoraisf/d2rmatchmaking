// Metric views (OBS-31, AD-095). Every instrument keeps only the bounded attribute sets, so no id or URL becomes a
// metric series; the HTTP instrumentation's duration histogram is dropped.
import {
  AggregationType,
  createAllowListAttributesProcessor,
  type IAttributesProcessor,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics';
import { APP_METER_NAME, INSTRUMENT_NAMES } from '../instrument-names.ts';

export { APP_METER_NAME };

/** The meter of `@opentelemetry/instrumentation-http`, whose duration histogram shares the application's name. */
export const HTTP_INSTRUMENTATION_METER_NAME = '@opentelemetry/instrumentation-http';

const ROUTE_AND_STATUS_CLASS = ['http.route', 'http.response.status_class'];
const ROOM_STAGE_KEYS = ['d2r.room.stage', 'd2r.difficulty', 'd2r.queue.mode'];

function onlyKeys(keys: string[]): IAttributesProcessor[] {
  return [createAllowListAttributesProcessor(keys)];
}

/**
 * One view per instrument of INSTRUMENT_NAMES, limited to its bounded keys. The two HTTP histograms are limited to the
 * application meter, so the instrumentation's histogram of the same name is never a second series; its drop view
 * removes it.
 */
export function boundedMetricViews(): ViewOptions[] {
  return [
    {
      instrumentName: INSTRUMENT_NAMES.httpServerRequestDuration,
      meterName: APP_METER_NAME,
      attributesProcessors: onlyKeys(ROUTE_AND_STATUS_CLASS),
    },
    {
      instrumentName: INSTRUMENT_NAMES.httpServerResponseBodySize,
      meterName: APP_METER_NAME,
      attributesProcessors: onlyKeys(ROUTE_AND_STATUS_CLASS),
    },
    {
      instrumentName: INSTRUMENT_NAMES.sseConnections,
      attributesProcessors: onlyKeys(['d2r.stream.kind']),
    },
    {
      instrumentName: INSTRUMENT_NAMES.outboxLag,
      attributesProcessors: onlyKeys([]),
    },
    {
      instrumentName: INSTRUMENT_NAMES.roomStageDuration,
      attributesProcessors: onlyKeys(ROOM_STAGE_KEYS),
    },
    {
      instrumentName: INSTRUMENT_NAMES.httpServerRequestDuration,
      meterName: HTTP_INSTRUMENTATION_METER_NAME,
      aggregation: { type: AggregationType.DROP },
    },
  ];
}
