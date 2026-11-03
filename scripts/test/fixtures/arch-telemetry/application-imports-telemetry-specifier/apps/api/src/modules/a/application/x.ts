// The bare workspace specifier (not a relative path): the cruiser must resolve it through the package's exports.
import { startNodeTelemetry } from '@d2rmm/telemetry/node';

export const start = startNodeTelemetry;
