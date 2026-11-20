import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selfCheckProblems } from '../delivery/self-check-line.mjs';

const checks = ['config', 'ocr', 'health', 'channel'].map((name) => ({ name, ok: true }));
const line = (over = {}) =>
  `${JSON.stringify({ ok: true, channel: 'staging', version: '0.3.0', checks, ...over })}\n`;

test('a passing line of the channel that was built is accepted, with CRLF too', () => {
  assert.deepEqual(selfCheckProblems(line(), 'staging'), []);
  assert.deepEqual(selfCheckProblems(line().replace('\n', '\r\n'), 'staging'), []);
});

test('a line of another channel is refused: a preview is never shipped as staging', () => {
  assert.deepEqual(selfCheckProblems(line({ channel: 'preview' }), 'staging'), [
    'the build says channel "preview", expected "staging"',
  ]);
  assert.match(selfCheckProblems(line({ channel: 'unknown' }), 'preview')[0], /"unknown"/);
});

test('a failed check, a failed verdict, a missing version or a missing online check is refused', () => {
  const failed = checks.map((c) => (c.name === 'health' ? { ...c, ok: false } : c));
  assert.deepEqual(selfCheckProblems(line({ ok: false, checks: failed }), 'staging'), [
    'the self-check did not pass',
    'the check "health" failed',
  ]);
  assert.ok(selfCheckProblems(line({ version: '' }), 'staging').includes('the line has no version'));
  assert.ok(selfCheckProblems(line({ version: undefined }), 'staging').includes('the line has no version'));
  const offline = checks.filter((c) => c.name !== 'health');
  assert.deepEqual(selfCheckProblems(line({ checks: offline }), 'staging'), [
    'the check "health" did not run (--online expected)',
  ]);
});

test('no output, several lines or text that is not JSON is refused', () => {
  assert.deepEqual(selfCheckProblems('', 'staging'), ['expected one JSON line, got 0']);
  assert.deepEqual(selfCheckProblems(undefined, 'staging'), ['expected one JSON line, got 0']);
  assert.deepEqual(selfCheckProblems(`${line()}${line()}`, 'staging'), ['expected one JSON line, got 2']);
  assert.deepEqual(selfCheckProblems('not json', 'staging'), ['the line is not JSON']);
  assert.deepEqual(selfCheckProblems('[1,2]\n', 'staging').length > 0, true);
});
