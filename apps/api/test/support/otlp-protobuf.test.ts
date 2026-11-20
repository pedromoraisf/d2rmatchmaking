import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { startNodeTelemetry } from '@d2rmm/telemetry/node';
import { describe, expect, it, vi } from 'vitest';
import { decodeOtlpProtobuf, decodeOtlpRequest, emptyOtlpReply } from './otlp-protobuf.ts';

/** The protobuf writer of the test: tag, length-delimited and varint fields, enough to build an export request. */
const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
};
const bytesField = (number: number, content: Buffer | string): Buffer => {
  const body = typeof content === 'string' ? Buffer.from(content) : content;
  return Buffer.concat([varint(number * 8 + 2), varint(body.length), body]);
};
const varintField = (number: number, value: number): Buffer =>
  Buffer.concat([varint(number * 8), varint(value)]);
const stringAttribute = (key: string, value: string): Buffer =>
  Buffer.concat([bytesField(1, key), bytesField(2, bytesField(1, value))]);
const intAttribute = (key: string, value: number): Buffer =>
  Buffer.concat([bytesField(1, key), bytesField(2, varintField(3, value))]);

const resource = bytesField(1, bytesField(1, stringAttribute('service.name', 'd2rmm-api')));
const traceId = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

describe('decodeOtlpProtobuf', () => {
  it('reads a trace request as the OTLP JSON the exporters wrote before', () => {
    const span = Buffer.concat([
      bytesField(1, traceId),
      bytesField(2, Buffer.from('aabbccddeeff0011', 'hex')),
      bytesField(5, 'GET /x'),
      varintField(6, 2),
      bytesField(9, stringAttribute('url.path', '/x')),
      bytesField(9, intAttribute('http.response.status_code', 200)),
    ]);
    const request = bytesField(1, Buffer.concat([resource, bytesField(2, bytesField(2, span))]));

    expect(decodeOtlpProtobuf('/v1/traces', request)).toEqual({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'd2rmm-api' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: traceId.toString('hex'),
                  spanId: 'aabbccddeeff0011',
                  name: 'GET /x',
                  kind: 2,
                  attributes: [
                    { key: 'url.path', value: { stringValue: '/x' } },
                    { key: 'http.response.status_code', value: { intValue: 200 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('reads metric names and log trace ids', () => {
    const metrics = bytesField(
      1,
      Buffer.concat([resource, bytesField(2, bytesField(2, bytesField(1, 'd2r.queue.size')))]),
    );
    expect(decodeOtlpProtobuf('/v1/metrics', metrics)).toMatchObject({
      resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'd2r.queue.size' }] }] }],
    });

    const logs = bytesField(
      1,
      Buffer.concat([resource, bytesField(2, bytesField(2, bytesField(9, traceId)))]),
    );
    expect(decodeOtlpProtobuf('/v1/logs', logs)).toMatchObject({
      resourceLogs: [{ scopeLogs: [{ logRecords: [{ traceId: traceId.toString('hex') }] }] }],
    });
    expect(() => decodeOtlpProtobuf('/v1/other', Buffer.alloc(0))).toThrow('not an OTLP signal path');
  });
});

describe('decodeOtlpRequest', () => {
  it('gunzips and decodes a protobuf body, and parses a JSON body as it is', () => {
    const metrics = bytesField(
      1,
      Buffer.concat([resource, bytesField(2, bytesField(2, bytesField(1, 'sse.connections')))]),
    );
    const headers = { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' };
    expect(decodeOtlpRequest('/v1/metrics', gzipSync(metrics), headers)).toMatchObject({
      resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'sse.connections' }] }] }],
    });
    expect(decodeOtlpRequest('/v1/traces', Buffer.from('{"resourceSpans":[]}'), {})).toEqual({
      resourceSpans: [],
    });
    expect(decodeOtlpRequest('/v1/traces', Buffer.alloc(0), {})).toBeUndefined();
  });
});

describe('emptyOtlpReply', () => {
  it('answers a protobuf request with an empty protobuf body and anything else with {}', () => {
    expect(emptyOtlpReply('application/x-protobuf')).toEqual({
      contentType: 'application/x-protobuf',
      body: Buffer.alloc(0),
    });
    expect(emptyOtlpReply('application/json')).toEqual({ contentType: 'application/json', body: '{}' });
    expect(emptyOtlpReply(undefined)).toEqual({ contentType: 'application/json', body: '{}' });
  });
});

describe('against the real exporters', () => {
  it('decodes what startNodeTelemetry posts, so the assertions read the same data as before', async () => {
    const decoded: { path: string; body: unknown; reply: ReturnType<typeof emptyOtlpReply> }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const path = request.url ?? '';
        const reply = emptyOtlpReply(request.headers['content-type']);
        decoded.push({ path, body: decodeOtlpRequest(path, Buffer.concat(chunks), request.headers), reply });
        response.writeHead(200, { 'content-type': reply.contentType });
        response.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const onExportError = vi.fn();
    const handle = startNodeTelemetry({
      serviceName: 'd2rmm-decode',
      serviceVersion: '0.0.0',
      environment: 'test',
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      samplerArg: '1',
      intervalMs: 60_000,
      onExportError,
    });
    const span = handle.tracerProvider
      .getTracer('t')
      .startSpan('operation', { attributes: { 'url.path': '/p' } });
    span.end();
    handle.meterProvider.getMeter('m').createCounter('d2r.decode.counter').add(1);
    handle.loggerProvider.getLogger('l').emit({ body: 'hello', severityNumber: 17 });
    await handle.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(onExportError).not.toHaveBeenCalled();
    const bodyOf = (path: string) => decoded.find((item) => item.path === path)?.body as never;
    expect(JSON.stringify(bodyOf('/v1/traces'))).toContain('"service.name"');
    const traces = bodyOf('/v1/traces') as {
      resourceSpans: {
        resource: { attributes: { key: string; value: { stringValue?: string } }[] };
        scopeSpans: {
          spans: { name: string; traceId: string; kind: number; attributes: { key: string }[] }[];
        }[];
      }[];
    };
    const [first] = traces.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    expect(first?.name).toBe('operation');
    expect(first?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first?.attributes.map((attribute) => attribute.key)).toContain('url.path');
    expect(
      traces.resourceSpans[0]?.resource.attributes.find((attribute) => attribute.key === 'service.name')
        ?.value.stringValue,
    ).toBe('d2rmm-decode');
    expect(JSON.stringify(bodyOf('/v1/metrics'))).toContain('d2r.decode.counter');
    expect(JSON.stringify(bodyOf('/v1/logs'))).toContain('logRecords');
  });
});
