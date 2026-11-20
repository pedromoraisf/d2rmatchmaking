// A free API server sleeps when idle and answers 502 or 503 while it wakes, which takes 30 to 60 seconds (DLP-07). The
// site reads its first answer through this: it says the server is waking and tries again, for up to 90 seconds.
import type { ApiResult } from '../shared/api-client.ts';

/** How long the site waits for a sleeping server before it shows the error (DLP-07). */
export const WAKE_BUDGET_MS = 90_000;
const FIRST_DELAY_MS = 2_000;
const LONGEST_DELAY_MS = 10_000;
/** How long one attempt may take before it is given up as a sleeping server (a waking server can hold a request). */
export const ATTEMPT_TIMEOUT_MS = 15_000;
/** The backoff varies by up to this fraction either way, so visitors who arrive together do not retry together. */
export const JITTER_FRACTION = 0.25;

/** The wait before retry number `attempt` (0 is the first): 2 s, growing by half each time, never over 10 s. */
export function wakeDelayMs(attempt: number): number {
  return Math.min(LONGEST_DELAY_MS, Math.round(FIRST_DELAY_MS * 1.5 ** attempt));
}

/** `delayMs` varied by up to {@link JITTER_FRACTION} either way; `random` returns a number in `[0, 1)`. */
export function jitteredDelayMs(delayMs: number, random: () => number): number {
  return Math.round(delayMs * (1 - JITTER_FRACTION + 2 * JITTER_FRACTION * random()));
}

export interface WakeOptions {
  /** Called once, when the first answer says the server is waking. */
  readonly onWaking: () => void;
  /** Waits `ms` milliseconds; replaced in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Total time to keep trying; default {@link WAKE_BUDGET_MS}. */
  readonly budgetMs?: number;
  /** Random source for the backoff jitter, in `[0, 1)`; default none (no jitter), the app passes `Math.random`. */
  readonly random?: () => number;
  /** Time limit of one attempt; default {@link ATTEMPT_TIMEOUT_MS}. */
  readonly attemptTimeoutMs?: number;
  /** Makes the signal that ends an attempt after `ms`; replaced in tests. */
  readonly timeoutSignal?: (ms: number) => AbortSignal;
  /** False once the caller no longer wants the answer (the page went away): the loop stops. */
  readonly active?: () => boolean;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `read` until it stops answering `waking` or the budget is spent; returns the last answer. */
export async function readWhenAwake<T>(
  read: (signal: AbortSignal) => Promise<ApiResult<T>>,
  options: WakeOptions,
): Promise<ApiResult<T>> {
  const sleep = options.sleep ?? realSleep;
  const budget = options.budgetMs ?? WAKE_BUDGET_MS;
  const random = options.random ?? (() => 0.5);
  const attemptTimeout = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const timeoutSignal = options.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  const active = options.active ?? (() => true);
  let waited = 0;
  let announced = false;
  for (let attempt = 0; ; attempt += 1) {
    const signal = timeoutSignal(attemptTimeout);
    const answer = await read(signal);
    // An attempt that ran out of time is a server that is still asleep, not a failure.
    const result: ApiResult<T> = !answer.ok && signal.aborted ? { ok: false, failure: 'waking' } : answer;
    if (result.ok || result.failure !== 'waking' || waited >= budget || !active()) {
      return result;
    }
    if (!announced) {
      announced = true;
      options.onWaking();
    }
    const delay = Math.min(jitteredDelayMs(wakeDelayMs(attempt), random), budget - waited);
    waited += delay;
    await sleep(delay);
  }
}
