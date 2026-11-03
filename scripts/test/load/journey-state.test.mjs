import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isError,
  onAssigned,
  onCreated,
  onObservationSent,
  onStatus,
  onTick,
  start,
  TIMEOUT_MS,
} from '../../load/lib/journey-state.mjs';

const ROOM = { roomId: 'room-1' };

/** An iteration that has its observation sent at `observedAt`. */
function observedAt(observedMs) {
  return onObservationSent(onAssigned(start(), ROOM, observedMs - 10), observedMs);
}

test('five second timeout: no created frame 5 000 ms after the observation is one error', () => {
  assert.equal(TIMEOUT_MS, 5000);
  const state = observedAt(1000);

  assert.equal(onTick(state, 5999).phase, 'observed', 'at 4 999 ms there is still time');
  const timedOut = onTick(state, 6000);
  assert.equal(timedOut.phase, 'timed-out');
  assert.equal(timedOut.errors, 1, 'the timeout is exactly one error');
  assert.equal(timedOut.latencyMs, null, 'a timed-out iteration has no latency');

  const later = onTick(timedOut, 9000);
  assert.equal(later.errors, 1, 'a further tick does not add an error');
  assert.equal(
    onCreated(later, 9500).phase,
    'timed-out',
    'a frame after the timeout is not the iteration of that frame',
  );
});

test('five second timeout: a created frame at 4 999 ms is a latency, at 5 001 ms a timeout', () => {
  const inTime = onCreated(observedAt(1000), 5999);
  assert.equal(inTime.phase, 'created');
  assert.equal(inTime.latencyMs, 4999, 'the latency is created minus observation');
  assert.equal(inTime.errors, 0);

  const late = onCreated(observedAt(1000), 6001);
  assert.equal(late.phase, 'timed-out');
  assert.equal(late.errors, 1, 'a frame 5 001 ms after the observation is one error');
  assert.equal(late.latencyMs, null);
});

test('a 429 is an error: every non-2xx status counts, 200, 202 and 204 do not', () => {
  assert.equal(isError(429), true);
  for (const status of [0, 301, 400, 401, 403, 404, 421, 500, 503]) {
    assert.equal(isError(status), true, `${status} is an error`);
  }
  for (const status of [200, 202, 204]) {
    assert.equal(isError(status), false, `${status} is not an error`);
  }

  const counted = onStatus(onStatus(start(), 429), 202);
  assert.equal(counted.errors, 1, 'a 429 on a journey request is one error, a 202 is none');
});

test('the iteration runs from the assignment to the created frame', () => {
  const assigned = onAssigned(start(), ROOM, 500);
  assert.equal(assigned.phase, 'waiting-assigned', 'an assignment alone waits for the observation');
  assert.equal(assigned.roomId, 'room-1');

  const observed = onObservationSent(assigned, 1200);
  assert.equal(observed.phase, 'observed');
  assert.equal(observed.observedAt, 1200);

  const created = onCreated(observed, 1450);
  assert.equal(created.phase, 'created');
  assert.equal(created.latencyMs, 250, 'the latency is the time from the observation to the created frame');
  assert.equal(created.errors, 0);
});

test('frames that come out of order or twice change nothing', () => {
  const fresh = start();
  assert.equal(onCreated(fresh, 100), fresh, 'a created frame before any observation is ignored');
  assert.equal(onObservationSent(fresh, 100), fresh, 'an observation before any assignment is ignored');
  assert.equal(onAssigned(fresh, {}, 100), fresh, 'an assignment without a room id is ignored');

  const assigned = onAssigned(fresh, ROOM, 100);
  assert.equal(onAssigned(assigned, { roomId: 'room-2' }, 150).roomId, 'room-1', 'the first assignment wins');
});

test('the journey module is an ES module with no import', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', '..', 'load', 'lib', 'journey-state.mjs'), 'utf8');
  assert.equal(/^\s*import\b/m.test(source), false, 'journey-state.mjs has no import, so k6 can load it');
  assert.equal(/\bconsole\./.test(source), false);
});
