import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bytesPerMatch,
  bytesPerPlayerHour,
  matchesPerPlayerHour,
  perPlayerHourByEvent,
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

test('matches a player plays per hour, and the bytes one match costs', () => {
  close(matchesPerPlayerHour(400, 100, 90), 160, '400 iterations over 100 players in 90 s');
  close(matchesPerPlayerHour(0, 100, 90), 0, 'no iteration');
  assert.throws(() => matchesPerPlayerHour(10, 0, 90), RangeError);
  close(bytesPerMatch(70000, 160), 437.5, 'bytes per player-hour over matches per player-hour');
  assert.equal(bytesPerMatch(70000, 0), null, 'no match is no division by zero');
});

test('each event count becomes bytes per player-hour', () => {
  const byEvent = {
    site: { 'room.assigned': 7_000_000 },
    agent: { 'room.assigned': 3_500_000 },
    other: 1_750_000,
  };
  const scaled = perPlayerHourByEvent(byEvent, 100, 3600);
  close(scaled.site['room.assigned'], 70000, 'site');
  close(scaled.agent['room.assigned'], 35000, 'agent');
  close(scaled.other, 17500, 'other');
  assert.throws(() => perPlayerHourByEvent(byEvent, 0, 3600), RangeError);
});
