// The byte counter of a measuring window (design.md § Byte meter and sink; LB-14, LB-21). Pure: the clock is passed in, so the
// rule never reads the time itself. The meter and the sink count the bytes they pass through with it; bytes outside an open
// window are ignored, so setup traffic before `start` and after `stop` never reaches a number.

/**
 * @param {() => number} now a monotonic clock in milliseconds
 * @returns {{ start: () => void, add: (bytes: number) => void, stop: () => { bytes: number, seconds: number } }}
 */
export function createWindowCounter(now) {
  if (typeof now !== 'function') {
    throw new TypeError('the window counter takes a clock function in milliseconds');
  }
  /** @type {{ startedAt: number, bytes: number } | null} */
  let open = null;

  return {
    start() {
      open = { startedAt: now(), bytes: 0 };
    },
    add(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new RangeError(`a byte count is a non-negative integer, got ${String(bytes)}`);
      }
      if (open !== null) open.bytes += bytes;
    },
    stop() {
      if (open === null) return { bytes: 0, seconds: 0 };
      const result = { bytes: open.bytes, seconds: (now() - open.startedAt) / 1000 };
      open = null;
      return result;
    },
  };
}
