// Where the telemetry bytes go: reads a directory the sink filled (`LOAD_TELEMETRY_CAPTURE_DIR`, a local run) and prints,
// per signal, the top contributors by span name, log scope/severity/event and metric name, with attribute keys only (never
// a value). Off the run path: nothing here runs in CI. Usage: `node scripts/load/telemetry-breakdown.mjs <dir> [--top 10] [--json]`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { breakdownOf, topOf } from './lib/otlp-breakdown.mjs';

/** The captures of a directory, in sequence order. */
export function capturesOf(directory) {
  return readdirSync(directory)
    .filter((name) => /^\d+-(traces|logs|metrics)\.bin$/.test(name))
    .sort()
    .map((name) => ({
      signal: /-(traces|logs|metrics)\.bin$/.exec(name)[1],
      raw: readFileSync(join(directory, name)),
    }));
}

export function reportOf(directory, limit) {
  const breakdown = breakdownOf(capturesOf(directory));
  return Object.fromEntries(
    Object.entries(breakdown).map(([signal, data]) => [
      signal,
      {
        requests: data.requests,
        wireBytes: data.wireBytes,
        protobufBytes: data.protobufBytes,
        distinct: data.rows.length,
        top: topOf(data, limit),
      },
    ]),
  );
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const [directory, ...rest] = process.argv.slice(2);
  if (directory === undefined) {
    console.error('usage: node scripts/load/telemetry-breakdown.mjs <capture dir> [--top 10]');
    process.exit(2);
  }
  const topIndex = rest.indexOf('--top');
  const limit = topIndex === -1 ? 10 : Number.parseInt(rest[topIndex + 1], 10);
  console.log(JSON.stringify(reportOf(directory, limit), null, 2));
}
