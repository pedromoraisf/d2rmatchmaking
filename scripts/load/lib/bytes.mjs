// Bytes per player-hour of the measuring window (spec Assumptions "Bytes per player-hour"; LB-14, LB-15). Pure.

/** The budget line of a player-hour: about 70 KB (docs/engineering/constraints.md; LB-15). */
export const EGRESS_BYTES_PER_PLAYER_HOUR = 70000;

/**
 * Bytes over the players and the window in hours. A zero player or window count is refused, never divided by.
 * @param {number} bytes bytes the API sent to the players in the window, headers included
 * @param {number} players players of the step
 * @param {number} windowSeconds length of the measuring window
 * @returns {number}
 */
export function bytesPerPlayerHour(bytes, players, windowSeconds) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError('bytes must be a non-negative number');
  }
  if (!(typeof players === 'number' && players > 0)) {
    throw new RangeError('players must be greater than zero');
  }
  if (!(typeof windowSeconds === 'number' && windowSeconds > 0)) {
    throw new RangeError('windowSeconds must be greater than zero');
  }
  return bytes / players / (windowSeconds / 3600);
}

/**
 * True when a player-hour costs at most the budget line (70 000 is within it, 70 001 is not).
 * @param {number} bytesPerHour
 * @returns {boolean}
 */
export function withinEgressBudget(bytesPerHour) {
  return bytesPerHour <= EGRESS_BYTES_PER_PLAYER_HOUR;
}
