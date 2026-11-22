import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { breakdownOf, fieldsOf, topOf } from '../../load/lib/otlp-breakdown.mjs';

const varint = (number) => {
  const bytes = [];
  let rest = number;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
};
const field = (number, payload) => {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  return Buffer.concat([varint(number * 8 + 2), varint(body.length), body]);
};
const attribute = (number, key, value) =>
  field(number, Buffer.concat([field(1, key), field(2, field(1, value))]));
const span = (name, attributes) =>
  field(2, Buffer.concat([field(5, name), ...attributes.map(([key, value]) => attribute(9, key, value))]));
const traces = (...spans) => field(1, field(2, Buffer.concat(spans)));
const logRecord = (severity, body, attributes = [], eventName) =>
  field(
    2,
    Buffer.concat([
      field(3, severity),
      field(5, field(1, body)),
      ...attributes.map(([key, value]) => attribute(6, key, value)),
      ...(eventName === undefined ? [] : [field(12, eventName)]),
    ]),
  );
const logs = (scope, ...records) =>
  field(1, field(2, Buffer.concat([field(1, field(1, scope)), ...records])));
const metrics = (...names) =>
  field(1, field(2, Buffer.concat(names.map((name) => field(2, field(1, name))))));

test('fieldsOf reads varints, fixed widths and length-delimited fields with their whole size', () => {
  const message = Buffer.concat([varint(8), varint(300), field(2, 'abc'), Buffer.from([0x1d, 1, 2, 3, 4])]);
  const fields = fieldsOf(message);
  assert.deepEqual(
    fields.map(({ field: number, wire, size }) => [number, wire, size]),
    [
      [1, 0, 3],
      [2, 2, 5],
      [3, 5, 5],
    ],
  );
  assert.equal(Buffer.from(fields[1].bytes).toString(), 'abc');
});

test('fieldsOf refuses a field that ends past the buffer', () => {
  assert.throws(() => fieldsOf(Buffer.from([0x12, 0x09, 0x61])), RangeError);
});

test('spans are grouped by name with counts, sizes, attribute keys and the full-tier-only bytes', () => {
  const body = traces(
    span('pg.query', [['db.query.text', 'select 1']]),
    span('pg.query', [['db.query.text', 'select 2']]),
    span('identity.login', [['d2r.account.battletag', 'Name#1234']]),
  );
  const { traces: result } = breakdownOf([{ signal: 'traces', raw: gzipSync(body) }]);
  assert.equal(result.requests, 1);
  assert.equal(result.protobufBytes, body.length);
  assert.equal(result.wireBytes, gzipSync(body).length);
  const [first, second] = topOf(result);
  assert.equal(first.name, 'pg.query');
  assert.equal(first.count, 2);
  assert.equal(first.productionBytes, first.protobufBytes, 'no full-tier key, nothing to drop');
  assert.deepEqual(first.topAttributeKeys, [{ key: 'db.query.text', bytesPerItem: 29 }]);
  assert.equal(second.name, 'identity.login');
  assert.ok(
    second.productionBytes < second.protobufBytes,
    'the BattleTag attribute is dropped in production',
  );
  assert.equal(JSON.stringify(topOf(result)).includes('select'), false, 'no attribute value in the output');
  assert.equal(JSON.stringify(topOf(result)).includes('Name#1234'), false);
});

test('an uncompressed body is read as it came, and a missing signal is empty', () => {
  const body = traces(span('a', []));
  const result = breakdownOf([{ signal: 'traces', raw: body }]);
  assert.equal(result.traces.wireBytes, body.length);
  assert.deepEqual(result.logs.rows, []);
});

test('logs are grouped by scope, severity and the event name, or a fixed phrase, never a body with a value', () => {
  const body = logs(
    '@opentelemetry/instrumentation-pino',
    logRecord('info', 'incoming request', [['reqId', 'req-1']]),
    logRecord('info', 'incoming request', [['reqId', 'req-2']]),
    logRecord('warn', 'room 4821 expired'),
    logRecord('warn', 'ignored', [], 'room.expired'),
  );
  const { logs: result } = breakdownOf([{ signal: 'logs', raw: body }]);
  const names = Object.fromEntries(result.rows.map((row) => [row.name, row.count]));
  assert.deepEqual(names, {
    '@opentelemetry/instrumentation-pino | info | body: incoming request': 2,
    '@opentelemetry/instrumentation-pino | warn | (no event name)': 1,
    '@opentelemetry/instrumentation-pino | warn | room.expired': 1,
  });
  assert.equal(JSON.stringify(topOf(result)).includes('4821'), false);
});

test('metrics are grouped by name', () => {
  const { metrics: result } = breakdownOf([
    { signal: 'metrics', raw: metrics('http.server.duration', 'db.client.operation.duration') },
    { signal: 'metrics', raw: metrics('http.server.duration') },
  ]);
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.count]),
    [
      ['http.server.duration', 2],
      ['db.client.operation.duration', 1],
    ],
  );
});

test('topOf orders by bytes, limits the list and estimates the wire bytes from the share', () => {
  const body = traces(
    span('small', []),
    span('large', [['k', 'v'.repeat(40)]]),
    span('large', [['k', 'v'.repeat(40)]]),
  );
  const { traces: result } = breakdownOf([{ signal: 'traces', raw: body }]);
  const top = topOf(result, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0].name, 'large');
  assert.equal(top[0].estimatedWireBytes, top[0].protobufBytes, 'an uncompressed body: wire equals protobuf');
  assert.ok(top[0].share > 0.5 && top[0].share < 1);
});
