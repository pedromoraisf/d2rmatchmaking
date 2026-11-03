// The nearest-rank 95th percentile of the windowed latency samples (LB-06). Pure: the verdict and the summary take their
// p95 from here, never from k6's interpolated Trend.

/**
 * The value at rank ceil(0.95 n) of the sorted samples; null for no samples. The input is not mutated.
 * @param {number[]} samples latency samples in milliseconds
 * @returns {number | null}
 */
export function p95(samples) {
  for (const sample of samples) {
    if (typeof sample !== 'number' || !Number.isFinite(sample)) {
      throw new TypeError(`a latency sample must be a finite number, got ${String(sample)}`);
    }
  }
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  // Integer arithmetic for the rank: 95 n / 100 is exact, so no float product can move the rank.
  const rank = Math.ceil((95 * sorted.length) / 100);
  return sorted[rank - 1];
}
