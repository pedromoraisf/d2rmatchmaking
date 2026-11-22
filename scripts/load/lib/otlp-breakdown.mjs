// The byte breakdown of captured OTLP/HTTP protobuf requests (the telemetry profile; `telemetry-breakdown.mjs`). Pure:
// bytes in, numbers out. It decodes only the wire structure it needs (no values are kept): a span by its name and the
// keys of its attributes, a log record by its scope, severity and event name, a metric by its name. Sizes are protobuf
// bytes before gzip; `wireBytes` of a request is the body as the sink read it.

import { gunzipSync } from 'node:zlib';

/** Attribute keys the production tier drops (ADR 037); the production-equivalent column subtracts them. */
export const FULL_TIER_ONLY_KEYS = Object.freeze([
  'd2r.account.battletag',
  'd2r.character.name',
  'd2r.observation.read_text',
  'd2r.observation.read_names',
]);

function readVarint(buffer, start) {
  let result = 0;
  let shift = 0;
  let offset = start;
  for (;;) {
    const byte = buffer[offset];
    if (byte === undefined) throw new RangeError('a protobuf varint ends past the buffer');
    offset += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, offset };
    shift += 7;
  }
}

/**
 * The fields of one message: `{ field, wire, value?, bytes?, size }`, where `size` is the whole field on the wire (tag,
 * length and payload) and `bytes` is the payload of a length-delimited field.
 * @param {Uint8Array} buffer
 * @returns {{ field: number, wire: number, value?: number, bytes?: Uint8Array, size: number }[]}
 */
export function fieldsOf(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const begin = offset;
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === 0) {
      const varint = readVarint(buffer, offset);
      offset = varint.offset;
      fields.push({ field, wire, value: varint.value, size: offset - begin });
    } else if (wire === 1 || wire === 5) {
      const width = wire === 1 ? 8 : 4;
      fields.push({
        field,
        wire,
        bytes: buffer.subarray(offset, offset + width),
        size: offset + width - begin,
      });
      offset += width;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      if (offset + length.value > buffer.length)
        throw new RangeError('a protobuf field ends past the buffer');
      fields.push({
        field,
        wire,
        bytes: buffer.subarray(offset, offset + length.value),
        size: offset + length.value - begin,
      });
      offset += length.value;
    } else {
      throw new RangeError(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

const text = (bytes) => Buffer.from(bytes).toString('utf8');
const all = (buffer, field) => fieldsOf(buffer).filter((entry) => entry.field === field && entry.wire === 2);

/** The key of a KeyValue message and the size of the whole attribute field. */
function keyOf(keyValue) {
  const key = fieldsOf(keyValue).find((entry) => entry.field === 1 && entry.wire === 2);
  return key === undefined ? '' : text(key.bytes);
}

/**
 * Bytes of the attribute fields of a message, by key, and the bytes the production tier would drop.
 * @param {Uint8Array} message
 * @param {number} attributeField the field number of the repeated KeyValue (spans 9, log records 6)
 */
function attributesOf(message, attributeField) {
  const byKey = new Map();
  let fullOnly = 0;
  for (const entry of fieldsOf(message)) {
    if (entry.field !== attributeField || entry.wire !== 2) continue;
    const key = keyOf(entry.bytes);
    byKey.set(key, (byKey.get(key) ?? 0) + entry.size);
    if (FULL_TIER_ONLY_KEYS.includes(key)) fullOnly += entry.size;
  }
  return { byKey, fullOnly };
}

function add(map, name, bytes, fullOnly) {
  const row = map.get(name) ?? { name, count: 0, bytes: 0, fullOnlyBytes: 0, attributeKeyBytes: new Map() };
  row.count += 1;
  row.bytes += bytes;
  row.fullOnlyBytes += fullOnly;
  map.set(name, row);
  return row;
}

function mergeKeys(row, byKey) {
  for (const [key, bytes] of byKey)
    row.attributeKeyBytes.set(key, (row.attributeKeyBytes.get(key) ?? 0) + bytes);
}

/** Spans of an ExportTraceServiceRequest, keyed by span name. */
function tracesOf(body, rows) {
  for (const resource of all(body, 1)) {
    for (const scope of all(resource.bytes, 2)) {
      for (const span of all(scope.bytes, 2)) {
        const name = fieldsOf(span.bytes).find((entry) => entry.field === 5 && entry.wire === 2);
        const { byKey, fullOnly } = attributesOf(span.bytes, 9);
        mergeKeys(add(rows, name === undefined ? '(unnamed)' : text(name.bytes), span.size, fullOnly), byKey);
      }
    }
  }
}

/** A log body, only when it is a short fixed phrase (letters and spaces): anything with a digit or a symbol may hold a value. */
function staticBodyOf(fields) {
  const body = fields.find((entry) => entry.field === 5 && entry.wire === 2);
  const value =
    body === undefined
      ? undefined
      : fieldsOf(body.bytes).find((entry) => entry.field === 1 && entry.wire === 2);
  const phrase = value === undefined ? '' : text(value.bytes);
  return /^[A-Za-z][A-Za-z ]{0,47}$/.test(phrase) ? `body: ${phrase}` : '(no event name)';
}

/** Log records of an ExportLogsServiceRequest, keyed by `<scope> <severity> <event name or (no event name)>`. */
function logsOf(body, rows) {
  for (const resource of all(body, 1)) {
    for (const scope of all(resource.bytes, 2)) {
      const scopeField = fieldsOf(scope.bytes).find((entry) => entry.field === 1 && entry.wire === 2);
      const scopeName =
        scopeField === undefined
          ? '(no scope)'
          : text(
              fieldsOf(scopeField.bytes).find((entry) => entry.field === 1 && entry.wire === 2)?.bytes ?? [],
            );
      for (const record of all(scope.bytes, 2)) {
        const fields = fieldsOf(record.bytes);
        const severity = fields.find((entry) => entry.field === 3 && entry.wire === 2);
        const event = fields.find((entry) => entry.field === 12 && entry.wire === 2);
        const label = event === undefined ? staticBodyOf(fields) : text(event.bytes);
        const { byKey, fullOnly } = attributesOf(record.bytes, 6);
        const name = `${scopeName} | ${severity === undefined ? '-' : text(severity.bytes)} | ${label}`;
        mergeKeys(add(rows, name, record.size, fullOnly), byKey);
      }
    }
  }
}

/** Metrics of an ExportMetricsServiceRequest, keyed by metric name. */
function metricsOf(body, rows) {
  for (const resource of all(body, 1)) {
    for (const scope of all(resource.bytes, 2)) {
      for (const metric of all(scope.bytes, 2)) {
        const name = fieldsOf(metric.bytes).find((entry) => entry.field === 1 && entry.wire === 2);
        add(rows, name === undefined ? '(unnamed)' : text(name.bytes), metric.size, 0);
      }
    }
  }
}

const DECODERS = { traces: tracesOf, logs: logsOf, metrics: metricsOf };

/** The protobuf of a captured body: gzip when it starts with the gzip magic, as it came otherwise. */
export function bodyOf(raw) {
  return raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
}

/**
 * The breakdown of captured requests.
 * @param {{ signal: 'traces' | 'logs' | 'metrics', raw: Uint8Array }[]} captures
 * @returns {Record<string, { requests: number, wireBytes: number, protobufBytes: number, rows: object[] }>}
 */
export function breakdownOf(captures) {
  const result = {};
  for (const signal of Object.keys(DECODERS)) {
    const rows = new Map();
    let wireBytes = 0;
    let protobufBytes = 0;
    let requests = 0;
    for (const capture of captures.filter((entry) => entry.signal === signal)) {
      const body = bodyOf(capture.raw);
      requests += 1;
      wireBytes += capture.raw.length;
      protobufBytes += body.length;
      DECODERS[signal](body, rows);
    }
    result[signal] = { requests, wireBytes, protobufBytes, rows: [...rows.values()] };
  }
  return result;
}

/**
 * The top contributors of one signal, with each one's share of the signal's protobuf bytes (spans, records and metrics
 * only; the request envelope and the resource are the remainder), its count, its estimated wire bytes (the share of the
 * signal's wire bytes), the share a production-tier export would keep, and its heaviest attribute keys by name only.
 * @param {{ wireBytes: number, protobufBytes: number, rows: object[] }} signal
 * @param {number} limit
 */
export function topOf(signal, limit = 10) {
  const total = signal.protobufBytes || 1;
  const wireRatio = signal.wireBytes / total;
  return [...signal.rows]
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => ({
      name: row.name,
      count: row.count,
      protobufBytes: row.bytes,
      share: row.bytes / total,
      meanBytes: row.bytes / row.count,
      estimatedWireBytes: Math.round(row.bytes * wireRatio),
      productionBytes: row.bytes - row.fullOnlyBytes,
      topAttributeKeys: [...row.attributeKeyBytes]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([key, bytes]) => ({ key, bytesPerItem: bytes / row.count })),
    }));
}
