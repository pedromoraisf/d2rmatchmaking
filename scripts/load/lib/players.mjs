// Unique player names and client addresses of the run (LB-03, LB-04; design.md § Pure rules). Pure: the random source is
// passed in, so the rule itself never draws a value. Each virtual player signs in with its own name and sends its own
// `X-Forwarded-For`, so no pairing limit (10 codes an hour per address, 10 submissions per account) is reached by one player.

const RUN_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RUN_ID_LENGTH = 8;
const RUN_ID_PATTERN = /^[a-z0-9]{8}$/;

/** The ceiling of the run: the 400-player step is the last one (LB-07). Indices run from 0 to 399. */
export const MAX_PLAYERS = 400;

/**
 * A run id of eight characters from `a-z0-9`. The random source is `randomInt(max)` (as `crypto.randomInt`): it returns an
 * integer from 0 up to, not including, `max`.
 * @param {(max: number) => number} randomInt
 * @returns {string}
 */
export function runIdFrom(randomInt) {
  let id = '';
  for (let position = 0; position < RUN_ID_LENGTH; position += 1) {
    const index = randomInt(RUN_ID_ALPHABET.length);
    if (!Number.isInteger(index) || index < 0 || index >= RUN_ID_ALPHABET.length) {
      throw new RangeError(`the random source must return an integer below ${RUN_ID_ALPHABET.length}`);
    }
    id += RUN_ID_ALPHABET[index];
  }
  return id;
}

/**
 * The name and the client address of one virtual player. The name is `lb`, the run id and the index in decimal: 2 to 14
 * letters and digits, unique per run id and index. The address is `10.0.x.y` for the index plus one, so 400 players
 * have 400 distinct addresses inside 10.0.0.0/8.
 * @param {string} runId eight characters from `a-z0-9`
 * @param {number} index an integer from 0 to 399
 * @returns {{ name: string, address: string }}
 */
export function playerFor(runId, index) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new TypeError('a run id is eight characters from a-z0-9');
  }
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PLAYERS) {
    throw new RangeError(`a player index is an integer from 0 to ${MAX_PLAYERS - 1}, got ${String(index)}`);
  }
  const host = index + 1;
  return {
    name: `lb${runId}${index}`,
    address: `10.0.${Math.floor(host / 256)}.${host % 256}`,
  };
}
