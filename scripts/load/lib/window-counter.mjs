// The byte counter of a measuring window (design.md § Byte meter and sink; LB-14, LB-21). Pure: the clock is passed in, so the
// rule never reads the time itself. The meter and the sink count the bytes they pass through with it; bytes outside an open
// window are ignored, so setup traffic before `start` and after `stop` never reaches a number.

/**
 * @param {() => number} now a monotonic clock in milliseconds
 * `add` takes an optional label (the sink labels each request by its OTLP signal). When a window saw any labelled bytes,
 * `stop` also answers `byLabel`, the bytes per label; every labelled byte is in `bytes` too, so the total is unchanged.
 * @returns {{
 *   start: () => void,
 *   add: (bytes: number, label?: string) => void,
 *   stop: () => { bytes: number, seconds: number, byLabel?: Record<string, number> },
 * }}
 */
export function createWindowCounter(now) {
  if (typeof now !== 'function') {
    throw new TypeError('the window counter takes a clock function in milliseconds');
  }
  /** @type {{ startedAt: number, bytes: number, labels: Map<string, number> } | null} */
  let open = null;

  return {
    start() {
      open = { startedAt: now(), bytes: 0, labels: new Map() };
    },
    add(bytes, label) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new RangeError(`a byte count is a non-negative integer, got ${String(bytes)}`);
      }
      if (open === null) return;
      open.bytes += bytes;
      if (label !== undefined) open.labels.set(label, (open.labels.get(label) ?? 0) + bytes);
    },
    stop() {
      if (open === null) return { bytes: 0, seconds: 0 };
      const result = { bytes: open.bytes, seconds: (now() - open.startedAt) / 1000 };
      if (open.labels.size > 0) result.byLabel = Object.fromEntries(open.labels);
      open = null;
      return result;
    },
  };
}
