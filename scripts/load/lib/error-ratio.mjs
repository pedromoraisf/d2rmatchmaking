// The error ratio of one step (spec Assumptions "What an error is, and the ratio"; LB-08). Pure: plain numbers in,
// a number out. Errors are journey requests answered non-2xx, streams closed early and iterations without a `created`
// frame in 5 s; the caller counts them, this rule only divides.

function countOf(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer, got ${String(value)}`);
  }
}

/**
 * Errors over journey requests plus iterations of the measuring window; 0 when that divisor is 0.
 * @param {{ errors: number, requests: number, iterations: number }} counts
 * @returns {number}
 */
export function errorRatio({ errors, requests, iterations }) {
  countOf('errors', errors);
  countOf('requests', requests);
  countOf('iterations', iterations);
  const divisor = requests + iterations;
  return divisor === 0 ? 0 : errors / divisor;
}

/**
 * The matches that were posted (2xx) and never started an iteration, over the whole step: each one is an error. Duplicate
 * assignment frames can make the iterations exceed the matches; that gives no negative count (design.md Revision 1, (d)).
 * @param {{ matchesPosted: number, iterationsStarted: number }} counts
 * @returns {number}
 */
export function lostAssignments({ matchesPosted, iterationsStarted }) {
  countOf('matchesPosted', matchesPosted);
  countOf('iterationsStarted', iterationsStarted);
  return Math.max(0, matchesPosted - iterationsStarted);
}

/**
 * The errors of a step the verdict uses: the k6 errors of the window, plus the lost assignments of the whole step, plus the
 * arrivals k6 dropped for lack of VUs (a dropped arrival is a match or a heartbeat that never happened). Whole-step losses
 * are added to the window's errors on purpose: the figure is conservative.
 * @param {{ errors: number, matchesPosted: number, iterationsStarted: number, droppedIterations: number }} counts
 * @returns {number}
 */
export function errorsOfStep({ errors, matchesPosted, iterationsStarted, droppedIterations }) {
  countOf('errors', errors);
  countOf('droppedIterations', droppedIterations);
  return errors + lostAssignments({ matchesPosted, iterationsStarted }) + droppedIterations;
}
