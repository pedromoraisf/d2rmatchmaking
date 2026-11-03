import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdictOf } from '../../load/lib/step-verdict.mjs';

const healthy = { containerOk: true, errorRatio: 0, p95Ms: 100 };

test('p95 boundary at 2000 ms', () => {
  assert.deepEqual(verdictOf({ ...healthy, p95Ms: 2000 }), { passed: true, failedRule: null });
  assert.deepEqual(verdictOf({ ...healthy, p95Ms: 2001 }), { passed: false, failedRule: 'latency' });
  assert.deepEqual(
    verdictOf({ ...healthy, p95Ms: null }),
    { passed: false, failedRule: 'latency' },
    'no samples fail the latency rule',
  );
});

test('error ratio boundary at 1%', () => {
  assert.deepEqual(verdictOf({ ...healthy, errorRatio: 0.0099 }), { passed: true, failedRule: null });
  assert.deepEqual(verdictOf({ ...healthy, errorRatio: 0.01 }), { passed: false, failedRule: 'errors' });
});

test('first failed rule order', () => {
  const dead = { containerOk: false, errorRatio: 0.5, p95Ms: 9000 };
  assert.equal(verdictOf(dead).failedRule, 'container', 'container is named before errors and latency');

  const erroring = { containerOk: true, errorRatio: 0.5, p95Ms: 9000 };
  assert.equal(verdictOf(erroring).failedRule, 'errors', 'errors are named before latency');

  const slow = { containerOk: true, errorRatio: 0, p95Ms: 9000 };
  assert.equal(verdictOf(slow).failedRule, 'latency');

  const noSamples = { containerOk: false, errorRatio: 0, p95Ms: null };
  assert.equal(verdictOf(noSamples).failedRule, 'container', 'a dead container outranks missing samples');
});

test('malformed step input is refused', () => {
  assert.throws(() => verdictOf({ ...healthy, containerOk: 'yes' }), TypeError);
  assert.throws(() => verdictOf({ ...healthy, errorRatio: -0.1 }), TypeError);
  assert.throws(() => verdictOf({ ...healthy, p95Ms: Number.NaN }), TypeError);
});
