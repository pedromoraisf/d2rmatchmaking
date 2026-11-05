// The state machine of one iteration of a virtual player (design.md § Pure rules, § k6 journey; LB-04, LB-05, LB-08).
//
// This file runs inside k6 as well as under Node, so it is a plain ES module with NO import at all: no Node module and no
// k6 module. It holds no clock; every transition takes the time from the caller, in milliseconds on the caller's clock.
// It avoids optional chaining and object spread so the k6 bundler needs nothing beyond ES2015.
//
// An iteration: `start()` (a new iteration waits for its match) -> `onAssigned` (the site stream's `room.assigned`) ->
// `onObservationSent` (the observation is posted) -> `onCreated` (the `created` frame of that room). Without that frame
// TIMEOUT_MS after the observation the iteration is `timed-out` with one error. A timer cannot run while a stream is open
// (design.md Revision 1, AD-121), so the rule is evaluated where a frame or the end of the stream arrives: `onCreated` and
// `onAssigned` settle a stale observation they receive, `onTick` and `onClose` settle it on the caller's clock, and the
// caller tallies each new error at `observedAt`, the time of its observation. A non-2xx answer to a journey request is an
// error of the iteration (`onStatus`). Every transition returns the next state; a settled state carries its `observedAt`,
// the latency of the iteration (created minus observation) and its error count.

export const TIMEOUT_MS = 5000;

/** The alphabet of an error kind: letters, digits, `:` and `-`. Any other kind is folded into `other` (AD-124). */
const KIND_PATTERN = /^[A-Za-z0-9:-]+$/u;

/**
 * The kind of an error that a non-2xx answer of a journey route gives: its status and its route (AD-124).
 * @param {number} status
 * @param {string} route
 * @returns {string}
 */
export function statusKind(status, route) {
  return 'status:' + String(status) + ':route:' + route;
}

/**
 * A kind inside the alphabet, or `other` for anything else (a space, an underscore, an empty name).
 * @param {string} name
 * @returns {string}
 */
export function kindOf(name) {
  return KIND_PATTERN.test(String(name)) ? String(name) : 'other';
}

/**
 * The idempotency key of one observation: the player's name and the room of the assignment, so the key is unique per room.
 * The API keeps the first observation of a repeated (agent, key) and stores nothing for a later one; a key counted per step
 * would repeat for a player that a later step reuses, and that room would never get its created frame. A room is new for
 * every match, so its key is new too. Plain ES2015, as the rest of this module.
 * @param {string} playerName
 * @param {string} roomId
 * @returns {string} at most 64 characters for a name of 16 and a room id of 36
 */
export function observationKeyOf(playerName, roomId) {
  return String(playerName) + '-' + String(roomId);
}

/**
 * The quarter of the step's players that a player index belongs to: 0 for the first quarter, 3 for the last (AD-124).
 * @param {number} index an index from 0 to count - 1
 * @param {number} count the players of the step
 * @returns {0 | 1 | 2 | 3}
 */
export function quarterOf(index, count) {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new TypeError(`a player index is an integer from 0 to ${count - 1}, got ${String(index)}`);
  }
  return Math.floor((index * 4) / count);
}

/**
 * A new iteration, waiting for the `room.assigned` frame of its match. `lastErrorKind` names the kind of the error that the
 * last transition added (null while there is none).
 * @returns {{ phase: string, roomId: string | null, assignedAt: number | null, observedAt: number | null, latencyMs: number | null, errors: number, lastErrorKind: string | null }}
 */
export function start() {
  return {
    phase: 'waiting-assigned',
    roomId: null,
    assignedAt: null,
    observedAt: null,
    latencyMs: null,
    errors: 0,
    lastErrorKind: null,
  };
}

/**
 * The `room.assigned` frame of the iteration's match. The first frame with a room id counts; others change nothing. A
 * stale observation that this frame finds is settled first: the `timed-out` state comes back with its one error.
 * @param {object} state
 * @param {{ roomId?: unknown }} frame
 * @param {number} nowMs
 */
export function onAssigned(state, frame, nowMs) {
  checkTime(nowMs);
  if (isStale(state, nowMs)) return timedOut(state, 'created-late');
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
  if (elapsed >= TIMEOUT_MS) return timedOut(state, 'created-late');
  return withFields(state, { phase: 'created', latencyMs: elapsed });
}

/**
 * The clock moved on: an observed iteration with no `created` frame TIMEOUT_MS after its observation times out.
 * @param {object} state
 * @param {number} nowMs
 */
export function onTick(state, nowMs) {
  checkTime(nowMs);
  return isStale(state, nowMs) ? timedOut(state, 'created-late') : state;
}

/**
 * The stream closed at `nowMs`: an observation still pending TIMEOUT_MS or more after its observation times out (one error,
 * tallied by the caller at `observedAt`). A younger observation, no observation, or a settled state is returned unchanged.
 * @param {object} state
 * @param {number} nowMs
 */
export function onClose(state, nowMs) {
  checkTime(nowMs);
  return isStale(state, nowMs) ? timedOut(state, 'pending-at-close') : state;
}

/**
 * A journey request of the iteration was answered. A non-2xx status is one error, of the kind of its status and its route.
 * @param {object} state
 * @param {number} status
 * @param {string} route the journey route that answered (`observation`, ...)
 */
export function onStatus(state, status, route) {
  if (!isError(status)) return state;
  return withFields(state, { errors: state.errors + 1, lastErrorKind: statusKind(status, route) });
}

/**
 * True for every status that is not 2xx: a `429` is an error (LB-04). A status of 0 (no answer) is an error too.
 * @param {number} status
 * @returns {boolean}
 */
export function isError(status) {
  return !(typeof status === 'number' && status >= 200 && status <= 299);
}

/** An observed iteration whose `created` frame is TIMEOUT_MS or more after its observation: the 5 s rule. */
function isStale(state, nowMs) {
  return state.phase === 'observed' && nowMs - state.observedAt >= TIMEOUT_MS;
}

function timedOut(state, kind) {
  return withFields(state, { phase: 'timed-out', errors: state.errors + 1, lastErrorKind: kind });
}

function withFields(state, changes) {
  return Object.assign({}, state, changes);
}

function checkTime(nowMs) {
  if (typeof nowMs !== 'number' || !isFinite(nowMs)) {
    throw new TypeError(`the time of a transition is a finite number of milliseconds, got ${String(nowMs)}`);
  }
}
