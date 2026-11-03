import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorRatio } from '../../load/lib/error-ratio.mjs';

test('error ratio is errors over requests plus iterations', () => {
  assert.equal(errorRatio({ errors: 3, requests: 70, iterations: 27 }), 3 / 97);
  assert.equal(errorRatio({ errors: 0, requests: 500, iterations: 100 }), 0);
  assert.equal(
    errorRatio({ errors: 1, requests: 0, iterations: 4 }),
    0.25,
    'iterations count in the divisor',
  );
  assert.equal(errorRatio({ errors: 1, requests: 4, iterations: 0 }), 0.25, 'requests count in the divisor');
});

test('zero divisor gives a zero ratio', () => {
  assert.equal(errorRatio({ errors: 0, requests: 0, iterations: 0 }), 0);
});

test('negative or non-integer counts are refused', () => {
  assert.throws(() => errorRatio({ errors: -1, requests: 10, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1.5, requests: 10, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1, requests: Number.NaN, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1, requests: 10, iterations: '10' }), TypeError);
});
