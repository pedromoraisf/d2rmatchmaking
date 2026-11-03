// The state machine of one iteration of a virtual player (design.md § Pure rules, § k6 journey; LB-04, LB-05, LB-08).
//
// This file runs inside k6 as well as under Node, so it is a plain ES module with NO import at all: no Node module and no
// k6 module. It holds no clock; every transition takes the time from the caller, in milliseconds on the caller's clock.
// It avoids optional chaining and object spread so the k6 bundler needs nothing beyond ES2015.
//
// An iteration: `start()` (the test match is requested) -> `onAssigned` (the site stream's `room.assigned`) ->
// `onObservationSent` (the observation is posted) -> `onCreated` (the `created` frame of that room). Without that frame
// TIMEOUT_MS after the observation the iteration is `timed-out` with one error (`onTick`). A non-2xx answer to a journey
// request is an error of the iteration (`onStatus`). Every transition returns the next state; the state carries the
// latency of the iteration (created minus observation) and its error count.

export const TIMEOUT_MS = 5000;

/**
 * A new iteration, waiting for the `room.assigned` frame of its match.
 * @returns {{ phase: string, roomId: string | null, assignedAt: number | null, observedAt: number | null, latencyMs: number | null, errors: number }}
 */
export function start() {
  return {
    phase: 'waiting-assigned',
    roomId: null,
    assignedAt: null,
    observedAt: null,
    latencyMs: null,
    errors: 0,
  };
}

/**
 * The `room.assigned` frame of the iteration's match. The first frame with a room id counts; others change nothing.
 * @param {object} state
 * @param {{ roomId?: unknown }} frame
 * @param {number} nowMs
 */
export function onAssigned(state, frame, nowMs) {
  checkTime(nowMs);
  if (state.phase !== 'waiting-assigned' || state.assignedAt !== null) return state;
  if (!frame || typeof frame.roomId !== 'string' || frame.roomId === '') return state;
  return withFields(state, { roomId: frame.roomId, assignedAt: nowMs });
}

/**
 * The observation has been sent (its request left, whatever its answer). Only after an assignment.
 * @param {object} state
 * @param {number} nowMs
 */
export function onObservationSent(state, nowMs) {
  checkTime(nowMs);
  if (state.phase !== 'waiting-assigned' || state.assignedAt === null) return state;
  return withFields(state, { phase: 'observed', observedAt: nowMs });
}

/**
 * The `created` frame of the room. Its latency is the time since the observation; a frame at or after TIMEOUT_MS is too
 * late and the iteration times out instead.
 * @param {object} state
 * @param {number} nowMs
 */
export function onCreated(state, nowMs) {
  checkTime(nowMs);
  if (state.phase !== 'observed') return state;
  const elapsed = nowMs - state.observedAt;
  if (elapsed >= TIMEOUT_MS) return timedOut(state);
  return withFields(state, { phase: 'created', latencyMs: elapsed });
}

/**
 * The clock moved on: an observed iteration with no `created` frame TIMEOUT_MS after its observation times out.
 * @param {object} state
 * @param {number} nowMs
 */
export function onTick(state, nowMs) {
  checkTime(nowMs);
  if (state.phase === 'observed' && nowMs - state.observedAt >= TIMEOUT_MS) return timedOut(state);
  return state;
}

/**
 * A journey request of the iteration was answered. A non-2xx status is one error.
 * @param {object} state
 * @param {number} status
 */
export function onStatus(state, status) {
  if (!isError(status)) return state;
  return withFields(state, { errors: state.errors + 1 });
}

/**
 * True for every status that is not 2xx: a `429` is an error (LB-04). A status of 0 (no answer) is an error too.
 * @param {number} status
 * @returns {boolean}
 */
export function isError(status) {
  return !(typeof status === 'number' && status >= 200 && status <= 299);
}

function timedOut(state) {
  return withFields(state, { phase: 'timed-out', errors: state.errors + 1 });
}

function withFields(state, changes) {
  return Object.assign({}, state, changes);
}

function checkTime(nowMs) {
  if (typeof nowMs !== 'number' || !isFinite(nowMs)) {
    throw new TypeError(`the time of a transition is a finite number of milliseconds, got ${String(nowMs)}`);
  }
}
