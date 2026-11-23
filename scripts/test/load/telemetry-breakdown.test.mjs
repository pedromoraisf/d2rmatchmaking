import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { capturesOf, reportOf } from '../../load/telemetry-breakdown.mjs';

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
const span = (name) => field(2, field(5, name));
const traces = (...names) => field(1, field(2, Buffer.concat(names.map(span))));
const logs = (...bodies) =>
  field(
    1,
    field(
      2,
      Buffer.concat([
        field(1, field(1, 'pino')),
        ...bodies.map((body) => field(2, Buffer.concat([field(3, 'info'), field(5, field(1, body))]))),
      ]),
    ),
  );

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'breakdown-'));
  writeFileSync(join(directory, '000002-logs.bin'), gzipSync(logs('request completed')));
  writeFileSync(join(directory, '000001-traces.bin'), gzipSync(traces('POST', 'POST', 'GET')));
  writeFileSync(join(directory, 'notes.txt'), 'not a capture');
  writeFileSync(join(directory, '000003-other.bin'), 'not a signal');
  return directory;
}

test('capturesOf lists only the capture files, in sequence order, with their signal', () => {
  const captures = capturesOf(fixture());
  assert.deepEqual(
    captures.map((capture) => capture.signal),
    ['traces', 'logs'],
  );
  assert.ok(Buffer.isBuffer(captures[0].raw));
});

test('reportOf counts requests and distinct names per signal and ranks the top by size', () => {
  const report = reportOf(fixture(), 1);
  assert.equal(report.traces.requests, 1);
  assert.equal(report.traces.distinct, 2);
  assert.equal(report.traces.top.length, 1);
  assert.equal(report.traces.top[0].name, 'POST');
  assert.equal(report.logs.requests, 1);
  assert.equal(report.logs.distinct, 1);
  assert.ok(report.traces.wireBytes > 0 && report.traces.protobufBytes > 0);
});
