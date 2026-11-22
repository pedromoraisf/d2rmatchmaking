// The byte breakdown of captured OTLP/HTTP protobuf requests (the telemetry profile; `telemetry-breakdown.mjs`). Pure:
// bytes in, numbers out. It decodes only the wire structure it needs (no values are kept): a span by its name and the
// keys of its attributes, a log record by its scope, severity and event name, a metric by its name. Sizes are protobuf
// bytes before gzip; `wireBytes` of a request is the body as the sink read it.

import { gunzipSync, gzipSync } from 'node:zlib';

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

function spanNameOf(span) {
  const name = fieldsOf(span).find((entry) => entry.field === 5 && entry.wire === 2);
  return name === undefined ? '(unnamed)' : text(name.bytes);
}

function scopeNameOf(scope) {
  const field = fieldsOf(scope).find((entry) => entry.field === 1 && entry.wire === 2);
  return field === undefined
    ? '(no scope)'
    : text(fieldsOf(field.bytes).find((entry) => entry.field === 1 && entry.wire === 2)?.bytes ?? []);
}

function logNameOf(scopeName, record) {
  const fields = fieldsOf(record);
  const severity = fields.find((entry) => entry.field === 3 && entry.wire === 2);
  const event = fields.find((entry) => entry.field === 12 && entry.wire === 2);
  const label = event === undefined ? staticBodyOf(fields) : text(event.bytes);
  return `${scopeName} | ${severity === undefined ? '-' : text(severity.bytes)} | ${label}`;
}

/** Spans of an ExportTraceServiceRequest, keyed by span name. */
function tracesOf(body, rows) {
  for (const resource of all(body, 1)) {
    for (const scope of all(resource.bytes, 2)) {
      for (const span of all(scope.bytes, 2)) {
        const { byKey, fullOnly } = attributesOf(span.bytes, 9);
        mergeKeys(add(rows, spanNameOf(span.bytes), span.size, fullOnly), byKey);
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
      const scopeName = scopeNameOf(scope.bytes);
      for (const record of all(scope.bytes, 2)) {
        const { byKey, fullOnly } = attributesOf(record.bytes, 6);
        const name = logNameOf(scopeName, record.bytes);
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
 * @returns {Record<string, { requests: number, wireBytes: number, protobufBytes: number, envelopeBytes: number, rows: object[] }>}
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
    const itemBytes = [...rows.values()].reduce((sum, row) => sum + row.bytes, 0);
    result[signal] = {
      requests,
      wireBytes,
      protobufBytes,
      envelopeBytes: protobufBytes - itemBytes,
      rows: [...rows.values()],
    };
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
export function topOf(signal, limit = 10, marginal = new Map()) {
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
      marginalWireBytes: marginal.get(row.name),
      marginalWireShare: marginal.has(row.name)
        ? marginal.get(row.name) / (signal.wireBytes || 1)
        : undefined,
      productionBytes: row.bytes - row.fullOnlyBytes,
      topAttributeKeys: [...row.attributeKeyBytes]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([key, bytes]) => ({ key, bytesPerItem: bytes / row.count })),
    }));
}

const encode = (number, payload) => {
  const length = [];
  let rest = payload.length;
  while (rest >= 0x80) {
    length.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  length.push(rest);
  return Buffer.concat([Buffer.from([number * 8 + 2, ...length]), payload]);
};

/**
 * A request without the items `drop(name)` selects: the same envelope, with the empty scopes and resources removed.
 * `itemField` is 2 for spans and log records, `nameOf(scope, item)` names an item.
 */
function withoutItems(body, nameOf, drop) {
  const resources = [];
  for (const resource of all(body, 1)) {
    const scopes = [];
    for (const scope of all(resource.bytes, 2)) {
      const scopeName = scopeNameOf(scope.bytes);
      const kept = [];
      let removed = 0;
      for (const entry of fieldsOf(scope.bytes)) {
        if (entry.field === 2 && entry.wire === 2 && drop(nameOf(scopeName, entry.bytes))) removed += 1;
        else kept.push(entry);
      }
      if (kept.some((entry) => entry.field === 2) || removed === 0) {
        scopes.push(encode(2, Buffer.concat(kept.map((entry) => rebuilt(entry)))));
      }
    }
    const others = fieldsOf(resource.bytes)
      .filter((entry) => entry.field !== 2)
      .map((entry) => rebuilt(entry));
    if (scopes.length > 0) resources.push(encode(1, Buffer.concat([...others, ...scopes])));
  }
  return Buffer.concat(resources);
}

function rebuilt(entry) {
  if (entry.wire === 2) return encode(entry.field, Buffer.from(entry.bytes));
  throw new RangeError('only length-delimited fields are rebuilt');
}

/**
 * The gzip bytes each name adds to the requests of one signal: the wire size of the requests with it, minus the wire size
 * without its spans or records (the same envelope, so the repeated resource and scope compress as they do in the export).
 * The marginals overlap a little, so they do not add up exactly to the signal's wire bytes. Traces and logs only.
 * @param {{ signal: string, raw: Uint8Array }[]} captures
 * @param {'traces' | 'logs'} signal
 * @returns {Map<string, number>}
 */
export function marginalWireBytes(captures, signal) {
  const nameOf = signal === 'traces' ? (_scope, item) => spanNameOf(item) : logNameOf;
  const bodies = captures.filter((entry) => entry.signal === signal).map((entry) => bodyOf(entry.raw));
  const marginal = new Map();
  for (const body of bodies) {
    const full = gzipSync(body).length;
    const names = new Set();
    for (const resource of all(body, 1)) {
      for (const scope of all(resource.bytes, 2)) {
        const scopeName = scopeNameOf(scope.bytes);
        for (const item of all(scope.bytes, 2)) names.add(nameOf(scopeName, item.bytes));
      }
    }
    for (const name of names) {
      const without = gzipSync(withoutItems(body, nameOf, (candidate) => candidate === name)).length;
      marginal.set(name, (marginal.get(name) ?? 0) + (full - without));
    }
  }
  return marginal;
}
