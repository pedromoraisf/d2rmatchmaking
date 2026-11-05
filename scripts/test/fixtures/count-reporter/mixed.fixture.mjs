// Fixture for scripts/test/count-reporter.test.mjs. It is not a *.test.mjs file, so `pnpm test:harness` does not run it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('counted proofs', () => {
  test('counted proof passes', () => {});
  test('counted proof fails among passing ones', () => {
    assert.equal(1, 2);
  });
});
