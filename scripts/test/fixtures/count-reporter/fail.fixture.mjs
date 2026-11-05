// Fixture for scripts/test/count-reporter.test.mjs. It is not a *.test.mjs file, so `pnpm test:harness` does not run it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('counted proof fails', () => {
  assert.equal(1, 2);
});
