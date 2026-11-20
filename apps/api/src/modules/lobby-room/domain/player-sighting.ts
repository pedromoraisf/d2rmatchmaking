// A chat sighting: `PLAYER_JOINED_SEEN` or `PLAYER_LEFT_SEEN` (SNM-01, SNM-03). The value the agent sends is one character
// name as the screen read it. It is checked here, matched to a member in the use case, and dropped: only the member's join
// order is ever stored.
import type { ObservationType } from './observation.ts';

/**
 * The reading rule of a chat name: 2 to 15 characters of letters and the digits `0` and `1` (the screen reads them for
 * `o`, `i` and `l`), first and last a letter, at most one inner `-` or `_`. The same rule as `PlayerNameValue` in the
 * contracts (a test keeps the two equal).
 */
const PLAYER_NAME = /^[A-Za-z](?:[A-Za-z01]|[-_](?=[A-Za-z01]))*[A-Za-z]$/;

export function isPlayerNameReading(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= 15 &&
    PLAYER_NAME.test(value) &&
    (value.match(/[-_]/g) ?? []).length <= 1
  );
}

/** The two observation types a chat sighting has. */
export function isPlayerSighting(type: ObservationType): boolean {
  return type === 'PLAYER_JOINED_SEEN' || type === 'PLAYER_LEFT_SEEN';
}
