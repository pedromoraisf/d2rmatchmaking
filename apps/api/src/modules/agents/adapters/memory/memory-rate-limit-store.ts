import type { RateLimitStore } from '../../application/ports.ts';

/** In-memory submission timestamps per key (ADR 006). The sweep prunes what no window still counts. */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #entries = new Map<string, Date[]>();

  async timestamps(key: string): Promise<Date[]> {
    return [...(this.#entries.get(key) ?? [])];
  }

  async record(key: string, at: Date): Promise<void> {
    this.#entries.set(key, [...(this.#entries.get(key) ?? []), new Date(at.getTime())]);
  }

  async prune(cutoff: Date): Promise<void> {
    for (const [key, times] of this.#entries) {
      const kept = times.filter((t) => t.getTime() > cutoff.getTime());
      if (kept.length === 0) {
        this.#entries.delete(key);
      } else {
        this.#entries.set(key, kept);
      }
    }
  }
}
