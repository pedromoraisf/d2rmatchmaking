// The verdict of one step (LB-08, LB-11). Pure: the three rules and the order in which a failure is named (AD-111).

export const P95_LIMIT_MS = 2000;
export const ERROR_RATIO_LIMIT = 0.01;

/**
 * Passes only when the API container held, the error ratio is below 1% and the p95 is at most 2000 ms. When several
 * rules fail, the first of `container`, `errors`, `latency` is named. A null p95 (no samples) fails `latency`.
 * @param {{ containerOk: boolean, errorRatio: number, p95Ms: number | null }} step
 * @returns {{ passed: boolean, failedRule: 'container' | 'errors' | 'latency' | null }}
 */
export function verdictOf({ containerOk, errorRatio, p95Ms }) {
  if (typeof containerOk !== 'boolean') {
    throw new TypeError('containerOk must be a boolean');
  }
  if (typeof errorRatio !== 'number' || !Number.isFinite(errorRatio) || errorRatio < 0) {
    throw new TypeError('errorRatio must be a non-negative number');
  }
  if (p95Ms !== null && (typeof p95Ms !== 'number' || Number.isNaN(p95Ms))) {
    throw new TypeError('p95Ms must be a number or null');
  }
  if (!containerOk) {
    return { passed: false, failedRule: 'container' };
  }
  if (errorRatio >= ERROR_RATIO_LIMIT) {
    return { passed: false, failedRule: 'errors' };
  }
  if (p95Ms === null || p95Ms > P95_LIMIT_MS) {
    return { passed: false, failedRule: 'latency' };
  }
  return { passed: true, failedRule: null };
}
