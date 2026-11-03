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
