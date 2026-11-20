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

/**
 * Matches a player plays per hour: the journey's iterations (one per player per room) over the players and the window.
 * @param {number} iterations
 * @param {number} players
 * @param {number} windowSeconds
 * @returns {number}
 */
export function matchesPerPlayerHour(iterations, players, windowSeconds) {
  return bytesPerPlayerHour(iterations, players, windowSeconds);
}

/**
 * The bytes one match costs a player: bytes per player-hour over matches per player-hour; null when no match was played, so
 * a figure is never divided by zero. Reading the egress per match lets runs of different cadence be compared.
 * @param {number} bytesPerHour
 * @param {number} matchesPerHour
 * @returns {number | null}
 */
export function bytesPerMatch(bytesPerHour, matchesPerHour) {
  return matchesPerHour > 0 ? bytesPerHour / matchesPerHour : null;
}

/**
 * Each count of `bytesByEvent` (`{ site: {...}, agent: {...}, other }`) as bytes per player-hour.
 * @param {{ site: Record<string, number>, agent: Record<string, number>, other: number }} byEvent
 * @param {number} players
 * @param {number} windowSeconds
 */
export function perPlayerHourByEvent(byEvent, players, windowSeconds) {
  const scale = (counts) =>
    Object.fromEntries(
      Object.entries(counts).map(([name, bytes]) => [
        name,
        bytesPerPlayerHour(bytes, players, windowSeconds),
      ]),
    );
  return {
    site: scale(byEvent.site),
    agent: scale(byEvent.agent),
    other: bytesPerPlayerHour(byEvent.other, players, windowSeconds),
  };
}
