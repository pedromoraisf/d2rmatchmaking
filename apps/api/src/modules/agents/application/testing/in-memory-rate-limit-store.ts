import type { RateLimitStore } from '../ports.ts';

/** In-memory RateLimitStore: the timestamps of counted submissions per key. */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly #entries = new Map<string, Date[]>();

  async timestamps(key: string): Promise<Date[]> {
    return [...(this.#entries.get(key) ?? [])];
  }

  async record(key: string, at: Date): Promise<void> {
    this.#entries.set(key, [...(this.#entries.get(key) ?? []), new Date(at.getTime())]);
  }
}
