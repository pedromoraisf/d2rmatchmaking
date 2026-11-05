/** Port for reading the current time. Domain and application code never call `Date.now()` directly. */
export interface Clock {
  now(): Date;
}

/** Test double: a clock that moves only when the test moves it. Every read and write copies the date. */
export class FakeClock implements Clock {
  #current: Date;
  readonly #listeners = new Set<(now: Date) => void>();

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
    this.#notify();
  }

  set(date: Date): void {
    this.#current = new Date(date.getTime());
    this.#notify();
  }

  /** Calls `listener` with the new instant after every `advance` or `set`. Returns the unsubscribe function. */
  onMove(listener: (now: Date) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      listener(this.now());
    }
  }
}
