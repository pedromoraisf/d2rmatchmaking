// A free API server sleeps when idle and answers 502 or 503 while it wakes, which takes 30 to 60 seconds (DLP-07). The
// site reads its first answer through this: it says the server is waking and tries again, for up to 90 seconds.
import type { ApiResult } from '../shared/api-client.ts';

/** How long the site waits for a sleeping server before it shows the error (DLP-07). */
export const WAKE_BUDGET_MS = 90_000;
const FIRST_DELAY_MS = 2_000;
const LONGEST_DELAY_MS = 10_000;

/** The wait before retry number `attempt` (0 is the first): 2 s, growing by half each time, never over 10 s. */
export function wakeDelayMs(attempt: number): number {
  return Math.min(LONGEST_DELAY_MS, Math.round(FIRST_DELAY_MS * 1.5 ** attempt));
}

export interface WakeOptions {
  /** Called once, when the first answer says the server is waking. */
  readonly onWaking: () => void;
  /** Waits `ms` milliseconds; replaced in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Total time to keep trying; default {@link WAKE_BUDGET_MS}. */
  readonly budgetMs?: number;
  /** False once the caller no longer wants the answer (the page went away): the loop stops. */
  readonly active?: () => boolean;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `read` until it stops answering `waking` or the budget is spent; returns the last answer. */
export async function readWhenAwake<T>(
  read: () => Promise<ApiResult<T>>,
  options: WakeOptions,
): Promise<ApiResult<T>> {
  const sleep = options.sleep ?? realSleep;
  const budget = options.budgetMs ?? WAKE_BUDGET_MS;
  const active = options.active ?? (() => true);
  let waited = 0;
  let announced = false;
  for (let attempt = 0; ; attempt += 1) {
    const result = await read();
    if (result.ok || result.failure !== 'waking' || waited >= budget || !active()) {
      return result;
    }
    if (!announced) {
      announced = true;
      options.onWaking();
    }
    const delay = Math.min(wakeDelayMs(attempt), budget - waited);
    waited += delay;
    await sleep(delay);
  }
}
