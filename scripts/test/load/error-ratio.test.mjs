import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorRatio, errorsOfStep, lostAssignments } from '../../load/lib/error-ratio.mjs';

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

test('lost assignments count as errors', () => {
  // A match posted (2xx) whose iteration never started is one error; a surplus of iterations (duplicate frames) is none.
  assert.equal(
    lostAssignments({ matchesPosted: 5, iterationsStarted: 3 }),
    2,
    'two matches never got an assignment',
  );
  assert.equal(
    lostAssignments({ matchesPosted: 5, iterationsStarted: 5 }),
    0,
    'every match started an iteration',
  );
  assert.equal(
    lostAssignments({ matchesPosted: 3, iterationsStarted: 5 }),
    0,
    'more iterations than matches is no loss',
  );

  assert.equal(
    errorsOfStep({ errors: 4, matchesPosted: 5, iterationsStarted: 3, droppedIterations: 0 }),
    6,
    'the k6 errors plus the two lost assignments',
  );
  assert.equal(
    errorsOfStep({ errors: 4, matchesPosted: 5, iterationsStarted: 5, droppedIterations: 0 }),
    4,
    'no lost assignment adds nothing',
  );
  assert.equal(
    errorsOfStep({ errors: 0, matchesPosted: 0, iterationsStarted: 0, droppedIterations: 3 }),
    3,
    'a dropped arrival is an error of the step',
  );

  const counted = errorsOfStep({ errors: 1, matchesPosted: 10, iterationsStarted: 8, droppedIterations: 1 });
  assert.equal(
    errorRatio({ errors: counted, requests: 70, iterations: 27 }),
    4 / 97,
    'the ratio is the same formula over the counted errors',
  );

  assert.throws(() => lostAssignments({ matchesPosted: -1, iterationsStarted: 0 }), TypeError);
  assert.throws(() => lostAssignments({ matchesPosted: 1.5, iterationsStarted: 0 }), TypeError);
  assert.throws(
    () => errorsOfStep({ errors: 0, matchesPosted: 0, iterationsStarted: 0, droppedIterations: -1 }),
    TypeError,
  );
});

test('negative or non-integer counts are refused', () => {
  assert.throws(() => errorRatio({ errors: -1, requests: 10, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1.5, requests: 10, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1, requests: Number.NaN, iterations: 10 }), TypeError);
  assert.throws(() => errorRatio({ errors: 1, requests: 10, iterations: '10' }), TypeError);
});
