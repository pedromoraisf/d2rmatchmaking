/**
 * Port for randomness. Production uses node:crypto (main/); domain and application code never call Math.random.
 * The seeded implementation below is deterministic and exists for tests and fixtures only.
 */
export interface RandomSource {
  /** An integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** `n` random bytes. */
  bytes(n: number): Uint8Array;
}

const UINT32_RANGE = 0x1_0000_0000;

/** Deterministic RandomSource (mulberry32): the same seed always yields the same sequence. */
export class SeededRandomSource implements RandomSource {
  #state: number;

  constructor(seed: number) {
    this.#state = seed | 0;
  }

  int(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError('int needs an integer bound between 1 and 2^32');
    }
    // Rejection sampling keeps every value equally likely: draws above the largest multiple of the bound are skipped.
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    for (;;) {
      const draw = this.#nextUint32();
      if (draw < limit) {
        return draw % maxExclusive;
      }
    }
  }

  bytes(n: number): Uint8Array {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new RangeError('bytes needs a non-negative integer length');
    }
    const out = new Uint8Array(n);
    let word = 0;
    for (let i = 0; i < n; i += 1) {
      if (i % 4 === 0) {
        word = this.#nextUint32();
      }
      out[i] = (word >>> ((i % 4) * 8)) & 0xff;
    }
    return out;
  }

  #nextUint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
}
