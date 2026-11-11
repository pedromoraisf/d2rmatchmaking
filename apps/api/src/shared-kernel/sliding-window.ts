// A sliding-window rate limit (ADR 006, AD-032): pure, so every module that limits submissions counts them the same way.

/** Outcome of checking one more submission against a window. */
export type WindowOutcome =
  { readonly outcome: 'allowed' } | { readonly outcome: 'limited'; readonly retryAt: Date };

/**
 * At most `limit` submissions in any `windowMs` span. A submission is in the window while `now - t < windowMs`, so a
 * limited caller is allowed again at exactly `oldest in-window submission + windowMs`. The caller records the
 * timestamps of the submissions it allowed.
 */
export class SlidingWindowLimit {
  readonly limit: number;
  readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(timestamps: readonly Date[], now: Date): WindowOutcome {
    const nowMs = now.getTime();
    const inWindow = timestamps
      .map((t) => t.getTime())
      .filter((t) => nowMs - t < this.windowMs)
      .sort((a, b) => a - b);
    if (inWindow.length < this.limit) {
      return { outcome: 'allowed' };
    }
    // The submission that must leave the window before one more is allowed.
    const blocking = inWindow[inWindow.length - this.limit] ?? nowMs;
    return { outcome: 'limited', retryAt: new Date(blocking + this.windowMs) };
  }
}
