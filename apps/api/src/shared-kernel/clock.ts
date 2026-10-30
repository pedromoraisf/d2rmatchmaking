/** Port for reading the current time. Domain and application code never call `Date.now()` directly. */
export interface Clock {
  now(): Date;
}

/** Test double: a clock that moves only when the test moves it. Every read and write copies the date. */
export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.#current.getTime());
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(date: Date): void {
    this.#current = new Date(date.getTime());
  }
}
