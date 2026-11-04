import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isError,
  kindOf,
  observationKeyOf,
  onAssigned,
  onClose,
  onCreated,
  onObservationSent,
  onStatus,
  onTick,
  quarterOf,
  start,
  statusKind,
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

  const atLimit = onCreated(observedAt(1000), 6000);
  assert.equal(atLimit.phase, 'timed-out', 'a frame 5 000 ms after the observation is too late');
  assert.equal(atLimit.errors, 1, 'and it is one error');
  assert.equal(atLimit.latencyMs, null, 'with no latency sample');

  const late = onCreated(observedAt(1000), 6001);
  assert.equal(late.phase, 'timed-out');
  assert.equal(late.errors, 1, 'a frame 5 001 ms after the observation is one error');
  assert.equal(late.latencyMs, null);
});

test('pending observation at the end of a stream', () => {
  // A stream that closes 5 000 ms or more after the observation settles it: one error, tallied at the observation.
  const pending = observedAt(1000);
  const young = onClose(pending, 5999);
  assert.equal(young.phase, 'observed', 'an observation 4 999 ms old is still pending, with no error');
  assert.equal(young.errors, 0);

  const old = onClose(pending, 6000);
  assert.equal(old.phase, 'timed-out');
  assert.equal(old.errors, 1, 'an observation 5 000 ms old at the close is one error');
  assert.equal(old.observedAt, 1000, 'the error is tallied at the observation, not at the close');
  assert.equal(old.latencyMs, null);
  assert.equal(onClose(old, 9000).errors, 1, 'a second close adds nothing');

  const waiting = onAssigned(start(), ROOM, 500);
  assert.equal(onClose(waiting, 99999), waiting, 'no observation sent is no error');
  assert.equal(onClose(start(), 99999).errors, 0, 'a new iteration is no error either');

  const created = onCreated(observedAt(1000), 1500);
  assert.equal(onClose(created, 99999), created, 'a created iteration is not pending');
  assert.equal(created.observedAt, 1000, 'a settled state carries the time of its observation');
});

test('timed out, then a second assigned frame', () => {
  // The site handler's order (design.md Revision 1, (d)): settle the stale observation first, tally its error at its
  // observation, then start the new iteration and take the assignment of the second frame.
  const tallied = [];
  const settle = (previous, next) => {
    for (let count = previous.errors; count < next.errors; count += 1) tallied.push(next.observedAt);
    return next;
  };
  let iteration = observedAt(1000);
  iteration = settle(iteration, onTick(iteration, 7000));
  assert.equal(iteration.phase, 'timed-out', 'the observation is 6 s old when the second frame arrives');

  iteration = onAssigned(start(), { roomId: 'room-2' }, 7000);
  assert.equal(iteration.roomId, 'room-2', 'the second frame starts a new iteration');
  assert.equal(iteration.phase, 'waiting-assigned');
  assert.deepEqual(tallied, [1000], 'one error, tallied once, at the stale observation');
});

test('a stale observation is settled by a late assignment, once', () => {
  const stale = observedAt(1000);
  const settled = onAssigned(stale, { roomId: 'room-2' }, 6000);
  assert.equal(settled.phase, 'timed-out', 'the frame settles the stale iteration instead of being dropped');
  assert.equal(settled.errors, 1);
  assert.equal(settled.observedAt, 1000);
  assert.equal(
    onAssigned(settled, { roomId: 'room-3' }, 6200),
    settled,
    'a settled state is not settled twice',
  );
  assert.equal(onCreated(settled, 6300), settled);

  const younger = onAssigned(observedAt(1000), { roomId: 'room-2' }, 5999);
  assert.equal(younger.phase, 'observed', 'an observation 4 999 ms old is not settled by an assignment');
  assert.equal(younger.errors, 0);
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
  assert.equal(/\?\./.test(source), false, 'no optional chaining, for the k6 bundler');
  assert.equal(/\{\s*\.\.\./.test(source), false, 'no object spread, for the k6 bundler');
});

test('an error names its kind: a status with its route, a late created frame, a pending observation at the close', () => {
  const state = observedAt(1000);
  assert.equal(onStatus(state, 500, 'observation').lastErrorKind, 'status:500:route:observation');
  assert.equal(onStatus(state, 204, 'observation').lastErrorKind, null, 'a 2xx answer names no kind');
  assert.equal(onCreated(state, 6000).lastErrorKind, 'created-late', 'a created frame at 5 000 ms is late');
  assert.equal(
    onTick(state, 6000).lastErrorKind,
    'created-late',
    'a stale observation found on the clock is late',
  );
  assert.equal(onClose(state, 6000).lastErrorKind, 'pending-at-close', 'a pending observation at the close');
  assert.equal(start().lastErrorKind, null, 'a new iteration has no error');
});

test('a kind is a status with its route, an alphabet value, or other; a quarter is the cohort of a player index', () => {
  assert.equal(statusKind(503, 'match-formed'), 'status:503:route:match-formed');
  assert.equal(kindOf('status:503:route:match-formed'), 'status:503:route:match-formed');
  assert.equal(kindOf('created-late'), 'created-late');
  assert.equal(kindOf('d2rmm_a_leak'), 'other', 'an underscore is outside the alphabet');
  assert.equal(kindOf('Bearer abc'), 'other', 'a space is outside the alphabet');
  assert.equal(kindOf(''), 'other', 'an empty kind is other');

  assert.equal(quarterOf(0, 25), 0);
  assert.equal(quarterOf(6, 25), 0);
  assert.equal(quarterOf(7, 25), 1);
  assert.equal(quarterOf(12, 25), 1);
  assert.equal(quarterOf(13, 25), 2);
  assert.equal(quarterOf(19, 25), 3);
  assert.equal(quarterOf(24, 25), 3);
  assert.throws(() => quarterOf(25, 25), TypeError, 'an index past the players is refused');
  assert.throws(() => quarterOf(-1, 25), TypeError, 'a negative index is refused');
});

test('an observation key is per room, so a player reused by a later step never repeats a key the API already holds', () => {
  // The API keeps the first observation of a repeated (agent, idempotencyKey) and stores nothing for a later one, so a key
  // counted from a per-step sequence ("name-1", "name-2") left the reused players' rooms without a created frame.
  const first = observationKeyOf('Alpha', 'a1b2c3d4-0000-4000-8000-000000000001');
  const later = observationKeyOf('Alpha', 'a1b2c3d4-0000-4000-8000-000000000002');
  assert.notEqual(first, later, 'two rooms of one player have two keys');
  assert.equal(
    observationKeyOf('Alpha', 'a1b2c3d4-0000-4000-8000-000000000001'),
    first,
    'the same room gives the same key, so a repeated post of it is still one observation',
  );
  assert.notEqual(
    observationKeyOf('Beta', 'a1b2c3d4-0000-4000-8000-000000000001'),
    first,
    'two players, two keys',
  );
  const longest = observationKeyOf('Abcdefghijklmnop', 'a1b2c3d4-0000-4000-8000-00000000000f');
  assert.ok(longest.length <= 64, 'a 16-character name and a UUID room fit the 64-character key limit');
  assert.match(longest, /^[A-Za-z0-9-]+$/u, 'the key holds only the name, a dash and the room id');
});
