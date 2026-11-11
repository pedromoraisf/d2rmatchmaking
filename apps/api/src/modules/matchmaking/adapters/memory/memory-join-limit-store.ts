import type { SlidingWindowLimit } from '../../../../shared-kernel/sliding-window.ts';
import type { JoinLimitStore } from '../../application/ports.ts';

/**
 * In-memory join attempts per account (ADR 006). `record` drops what the window no longer counts, so an account never
 * keeps more than `limit` timestamps; an account that stops joining keeps one small entry until the process restarts.
 */
export class MemoryJoinLimitStore implements JoinLimitStore {
  readonly #entries = new Map<string, Date[]>();
  readonly #window: SlidingWindowLimit;

  constructor(window: SlidingWindowLimit) {
    this.#window = window;
  }

  async timestamps(accountId: string): Promise<readonly Date[]> {
    return [...(this.#entries.get(accountId) ?? [])];
  }

  async record(accountId: string, at: Date): Promise<void> {
    const kept = (this.#entries.get(accountId) ?? []).filter(
      (time) => at.getTime() - time.getTime() < this.#window.windowMs,
    );
    this.#entries.set(accountId, [...kept, new Date(at.getTime())]);
  }

  /** The acceptance stack's reset forgets every attempt (test controls, AD-045). */
  clear(): void {
    this.#entries.clear();
  }
}
