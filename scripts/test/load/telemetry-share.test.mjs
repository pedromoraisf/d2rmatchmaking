import assert from 'node:assert/strict';
import { test } from 'node:test';
import { telemetryFails, telemetryNumbers } from '../../load/lib/telemetry-share.mjs';

const close = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * 1e-9,
    `${label}: ${actual} is not ${expected}`,
  );

test('telemetry numbers', () => {
  // 17 500 bytes over 100 players and a 90 s window is 7 000 bytes per player-hour.
  const numbers = telemetryNumbers(17500, 100, 90);
  close(numbers.telemetryBytesPerPlayerHour, 7000, 'per player-hour');
  close(numbers.telemetryMonthlyBytes, 7000 * 100 * 720, '100 players for 720 hours');
  assert.equal(
    numbers.relayAllowanceMonthlyBytes,
    16 * 1024 * 1024 * 30,
    'the relay allowance, 16 MiB times 30',
  );
  close(numbers.telemetryShareOfBudget, (7000 * 100 * 720) / (5 * 1024 ** 3), 'the share of 5 GiB');
});

test('share boundary at 0.10', () => {
  assert.equal(telemetryFails(0.1), false, 'exactly 0.10 passes');
  assert.equal(telemetryFails(0.09), false);
  assert.equal(telemetryFails(0.1 + 1e-9), true, 'just above 0.10 fails');
  assert.equal(telemetryFails(0.2), true);
});
