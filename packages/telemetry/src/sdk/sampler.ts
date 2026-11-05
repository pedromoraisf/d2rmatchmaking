// The sampler of the API, the site and the agent (OBS-43, AD-100). A ratio decides by trace id, the same way in every
// process: a trace is sampled when the lower 8 bytes of its id, shifted right by one, are below floor(ratio * 2^63).
// That is the rule of opentelemetry_sdk in Rust, so the shared vector in apps/agent/src-tauri/adapters/test-vectors/sampler.json holds for both.
import type { Context } from '@opentelemetry/api';
import {
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';

const DEFAULT_RATIO = 0.1;
// One token bucket shared by every branch that is not a followed local parent: a caller cannot export more than this.
const CAP_TRACES_PER_SECOND = 20;
const CAP_BURST = 40;
const TWO_POW_63 = 2 ** 63;

/** The ratio from the text; `0.1` when unset, empty or not a number in [0, 1]. */
function parseRatio(text: string | undefined): number {
  if (text === undefined || text.trim() === '') return DEFAULT_RATIO;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_RATIO;
}

function traceIdPassesRatio(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  const threshold = BigInt(Math.floor(ratio * TWO_POW_63));
  const lowerEight = BigInt(`0x${traceId.slice(16)}`);
  return lowerEight >> 1n < threshold;
}

/** Tokens refill at CAP_TRACES_PER_SECOND up to CAP_BURST; the bucket starts full. `now` is injected. */
class SharedTokenBucket {
  readonly #now: () => number;
  #tokens: number = CAP_BURST;
  #last: number;

  constructor(now: () => number) {
    this.#now = now;
    this.#last = now();
  }

  take(): boolean {
    const current = this.#now();
    const elapsedSeconds = Math.max(0, current - this.#last) / 1000;
    this.#last = current;
    this.#tokens = Math.min(CAP_BURST, this.#tokens + elapsedSeconds * CAP_TRACES_PER_SECOND);
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

/** Samples by ratio, and only when the ratio check passes does it take a token from the shared bucket. */
class CappedRatioSampler implements Sampler {
  readonly #ratio: number;
  readonly #bucket: SharedTokenBucket;

  constructor(ratio: number, bucket: SharedTokenBucket) {
    this.#ratio = ratio;
    this.#bucket = bucket;
  }

  shouldSample(_context: Context, traceId: string): SamplingResult {
    if (!traceIdPassesRatio(traceId, this.#ratio)) return { decision: SamplingDecision.NOT_RECORD };
    const admitted = this.#bucket.take();
    return { decision: admitted ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD };
  }

  toString(): string {
    return `CappedRatio{${this.#ratio}, ${CAP_TRACES_PER_SECOND}/s, burst ${CAP_BURST}}`;
  }
}

/**
 * A parent-based sampler. A local parent is followed as its flag says. Roots and remote parents, sampled or not, use
 * the ratio and the shared cap, so a caller's `sampled` flag alone never forces an export (AD-100).
 */
export function samplerFrom(ratioText: string | undefined, now: () => number = () => Date.now()): Sampler {
  const capped = new CappedRatioSampler(parseRatio(ratioText), new SharedTokenBucket(now));
  return new ParentBasedSampler({
    root: capped,
    remoteParentSampled: capped,
    remoteParentNotSampled: capped,
  });
}
