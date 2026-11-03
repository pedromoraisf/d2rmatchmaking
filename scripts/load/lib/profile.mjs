// Step table and measuring windows of the load run (design.md § Pure rules; LB-07, LB-09). Pure: no clock, no
// environment, no file. Every number is in seconds; `windowOffsets` count from the start of k6 (the clock the
// meters are driven from), `windowInHold` counts from the start of the hold, for the reader.

const FULL_PLAYERS = [25, 50, 100, 150, 200, 300, 400];
const RAMP_SECONDS = 20;
const FULL_HOLD_SECONDS = 120;
const FULL_WINDOW_SECONDS = 90;
const SMOKE_PLAYERS = 5;
const SMOKE_HOLD_SECONDS = 30;

function stepOf(players, holdSeconds, windowSeconds) {
  const windowStartInHold = holdSeconds - windowSeconds;
  return {
    players,
    rampSeconds: RAMP_SECONDS,
    holdSeconds,
    windowSeconds,
    windowInHold: { start: windowStartInHold, end: holdSeconds },
    windowOffsets: { start: RAMP_SECONDS + windowStartInHold, end: RAMP_SECONDS + holdSeconds },
  };
}

/**
 * The step table of a profile. The full profile runs 25 to 400 players, each step ramping for 20 s, holding for 120 s
 * and measuring the last 90 s of the hold. The smoke profile runs one step of 5 players holding for 30 s; a 30 s hold
 * cannot hold a 90 s window, so its window is the whole hold.
 * @param {'full' | 'smoke'} name
 * @returns {{ profile: 'full' | 'smoke', steps: object[] }}
 */
export function profileFor(name) {
  if (name === 'full') {
    return {
      profile: 'full',
      steps: FULL_PLAYERS.map((players) => stepOf(players, FULL_HOLD_SECONDS, FULL_WINDOW_SECONDS)),
    };
  }
  if (name === 'smoke') {
    return {
      profile: 'smoke',
      steps: [stepOf(SMOKE_PLAYERS, SMOKE_HOLD_SECONDS, Math.min(FULL_WINDOW_SECONDS, SMOKE_HOLD_SECONDS))],
    };
  }
  throw new TypeError(`unknown profile: ${String(name)}`);
}

/**
 * The step after the given results: the next step of the profile, or null when a step failed or the last step ran.
 * @param {'full' | 'smoke'} name
 * @param {{ passed: boolean }[]} results the results so far, in order
 * @returns {object | null}
 */
export function nextStep(name, results) {
  const { steps } = profileFor(name);
  if (results.some((result) => typeof result.passed !== 'boolean')) {
    throw new TypeError('every step result needs a boolean passed');
  }
  if (results.some((result) => result.passed === false)) {
    return null;
  }
  return results.length < steps.length ? steps[results.length] : null;
}
