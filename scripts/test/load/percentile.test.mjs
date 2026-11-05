import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p95 } from '../../load/lib/percentile.mjs';

const range = (n) => Array.from({ length: n }, (_, index) => index + 1);

test('nearest-rank p95', () => {
  assert.equal(p95(range(20)), 19, 'rank ceil(0.95 x 20) = 19');
  assert.equal(p95(range(21)), 20, 'rank ceil(0.95 x 21) = 20');
  assert.equal(p95(range(100)), 95, 'rank ceil(0.95 x 100) = 95');
  assert.equal(p95(range(60)), 57, 'rank ceil(0.95 x 60) = 57, with no float error');
  assert.equal(p95([42]), 42, 'one sample is its own p95');
  assert.equal(p95([5, 1, 4, 2, 3]), 5, 'rank ceil(4.75) = 5 of the sorted samples');
  assert.equal(p95([]), null, 'no samples gives null');
});

test('p95 does not mutate its input and refuses non-numbers', () => {
  const samples = [9, 3, 7];
  assert.equal(p95(samples), 9);
  assert.deepEqual(samples, [9, 3, 7], 'the caller keeps its order');
  assert.throws(() => p95([1, Number.NaN]), TypeError);
  assert.throws(() => p95(['12']), TypeError);
});
