// A decoder for the OTLP/HTTP requests the API exports (protobuf, gzip), for the fake backends of the tests. It reads only the
// fields the assertions need and answers the same JSON shape the exporters wrote before the switch to protobuf
// (`resourceSpans[].scopeSpans[].spans[]`, `resourceMetrics…metrics[].name`, `resourceLogs…logRecords[].traceId`), so a test
// reads the decoded data the way it always did. A JSON body (the browser relay's) is parsed as it is.
import { gunzipSync } from 'node:zlib';

/** The most a gzip body may inflate to; a larger one is refused, so a test backend never expands a bomb. */
export const MAX_DECODED_BYTES = 16 * 1024 * 1024;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

interface Field {
  readonly number: number;
  readonly wire: number;
  readonly varint: number;
  readonly bytes: Buffer;
}

function readVarint(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let position = start;
  for (;;) {
    const byte = buffer[position];
    if (byte === undefined) throw new Error('truncated protobuf varint');
    position += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: position };
    shift += 7;
  }
}

function fieldsOf(buffer: Buffer): Field[] {
  const fields: Field[] = [];
  let position = 0;
  const empty = Buffer.alloc(0);
  while (position < buffer.length) {
    const tag = readVarint(buffer, position);
    position = tag.next;
    const number = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === WIRE_VARINT) {
      const read = readVarint(buffer, position);
      position = read.next;
      fields.push({ number, wire, varint: read.value, bytes: empty });
    } else if (wire === WIRE_LENGTH_DELIMITED) {
      const length = readVarint(buffer, position);
      position = length.next + length.value;
      fields.push({ number, wire, varint: 0, bytes: buffer.subarray(length.next, position) });
    } else if (wire === WIRE_FIXED64 || wire === WIRE_FIXED32) {
      const size = wire === WIRE_FIXED64 ? 8 : 4;
      fields.push({ number, wire, varint: 0, bytes: buffer.subarray(position, position + size) });
      position += size;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

const messages = (buffer: Buffer, number: number): Buffer[] =>
  fieldsOf(buffer)
    .filter((field) => field.number === number && field.wire === WIRE_LENGTH_DELIMITED)
    .map((field) => field.bytes);

const text = (buffer: Buffer, number: number): string | undefined =>
  messages(buffer, number)[0]?.toString('utf8');

const hex = (buffer: Buffer, number: number): string => messages(buffer, number)[0]?.toString('hex') ?? '';

const varint = (buffer: Buffer, number: number): number =>
  fieldsOf(buffer).find((field) => field.number === number && field.wire === WIRE_VARINT)?.varint ?? 0;

function keyValueOf(buffer: Buffer): { key: string; value: { stringValue?: string; intValue?: number } } {
  const value = messages(buffer, 2)[0] ?? Buffer.alloc(0);
  const string = text(value, 1);
  const integer = fieldsOf(value).find((field) => field.number === 3 && field.wire === WIRE_VARINT);
  return {
    key: text(buffer, 1) ?? '',
    value: {
      ...(string === undefined ? {} : { stringValue: string }),
      ...(integer === undefined ? {} : { intValue: integer.varint }),
    },
  };
}

const resourceOf = (buffer: Buffer) => ({
  attributes: messages(messages(buffer, 1)[0] ?? Buffer.alloc(0), 1).map(keyValueOf),
});

function spanOf(buffer: Buffer) {
  return {
    traceId: hex(buffer, 1),
    spanId: hex(buffer, 2),
    ...(messages(buffer, 4).length === 0 ? {} : { parentSpanId: hex(buffer, 4) }),
    name: text(buffer, 5) ?? '',
    kind: varint(buffer, 6),
    attributes: messages(buffer, 9).map(keyValueOf),
  };
}

/** The OTLP/JSON shape of one protobuf export request, by the signal path it was posted to. */
export function decodeOtlpProtobuf(signalPath: string, body: Buffer): unknown {
  if (signalPath === '/v1/traces') {
    return {
      resourceSpans: messages(body, 1).map((resourceSpans) => ({
        resource: resourceOf(resourceSpans),
        scopeSpans: messages(resourceSpans, 2).map((scope) => ({ spans: messages(scope, 2).map(spanOf) })),
      })),
    };
  }
  if (signalPath === '/v1/metrics') {
    return {
      resourceMetrics: messages(body, 1).map((resourceMetrics) => ({
        resource: resourceOf(resourceMetrics),
        scopeMetrics: messages(resourceMetrics, 2).map((scope) => ({
          metrics: messages(scope, 2).map((metric) => ({ name: text(metric, 1) ?? '' })),
        })),
      })),
    };
  }
  if (signalPath === '/v1/logs') {
    return {
      resourceLogs: messages(body, 1).map((resourceLogs) => ({
        resource: resourceOf(resourceLogs),
        scopeLogs: messages(resourceLogs, 2).map((scope) => ({
          logRecords: messages(scope, 2).map((record) => ({ traceId: hex(record, 9) })),
        })),
      })),
    };
  }
  throw new Error(`${signalPath} is not an OTLP signal path`);
}

/**
 * Decodes what an exporter posted: gunzips a `Content-Encoding: gzip` body, then reads protobuf or JSON by its
 * `Content-Type`. An empty body is `undefined`.
 */
export function decodeOtlpRequest(
  signalPath: string,
  body: Buffer,
  headers: { 'content-type'?: string | undefined; 'content-encoding'?: string | undefined },
): unknown {
  const plain =
    headers['content-encoding'] === 'gzip' ? gunzipSync(body, { maxOutputLength: MAX_DECODED_BYTES }) : body;
  if (plain.length === 0) return undefined;
  if ((headers['content-type'] ?? '').startsWith('application/x-protobuf')) {
    return decodeOtlpProtobuf(signalPath, plain);
  }
  return JSON.parse(plain.toString('utf8'));
}

/** The reply a protobuf export request needs: a valid, empty response message with its content type. */
export function emptyOtlpReply(requestContentType: string | undefined): {
  readonly contentType: string;
  readonly body: Buffer | string;
} {
  return (requestContentType ?? '').startsWith('application/x-protobuf')
    ? { contentType: 'application/x-protobuf', body: Buffer.alloc(0) }
    : { contentType: 'application/json', body: '{}' };
}
