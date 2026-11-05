import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bytesPerPlayerHour,
  EGRESS_BYTES_PER_PLAYER_HOUR,
  withinEgressBudget,
} from '../../load/lib/bytes.mjs';

const close = (actual, expected, label = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} is not ${expected}`.trim());

test('bytes per player-hour', () => {
  close(bytesPerPlayerHour(7_000_000, 100, 3600), 70000, 'one hour: bytes over 100 players');
  close(bytesPerPlayerHour(175000, 100, 90), 70000, 'a 90 s window: 90 / 3600 of an hour');
  close(bytesPerPlayerHour(0, 100, 90), 0, 'no bytes, no cost');

  assert.equal(EGRESS_BYTES_PER_PLAYER_HOUR, 70000);
  assert.equal(withinEgressBudget(70000), true, '70 000 is within the budget');
  assert.equal(withinEgressBudget(70001), false, '70 001 is over the budget');
});

test('a zero player or window count is refused', () => {
  assert.throws(() => bytesPerPlayerHour(1000, 0, 90), RangeError);
  assert.throws(() => bytesPerPlayerHour(1000, 100, 0), RangeError);
  assert.throws(() => bytesPerPlayerHour(-1, 100, 90), TypeError);
});
