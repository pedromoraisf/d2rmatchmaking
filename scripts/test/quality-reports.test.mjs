import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../lib/tests-summary.mjs';

test('summarize counts two pending and one todo test as three skipped', () => {
  const vitest = {
    numTotalTests: 6,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 2,
    numTodoTests: 1,
  };
  assert.deepEqual(summarize(vitest), { total: 6, passed: 3, failed: 0, skipped: 3 });
});

test('summarize refuses a report without test counts instead of reading zero skipped', () => {
  assert.throws(() => summarize({ numPassedTests: 1 }), /not a Vitest JSON report/);
});
