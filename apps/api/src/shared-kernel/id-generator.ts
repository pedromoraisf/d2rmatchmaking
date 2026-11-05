/** Port for minting identifiers. Domain and application code never call a random or UUID source directly. */
export interface IdGenerator {
  next(): string;
}

/** Deterministic generator for tests and fixtures: `<prefix>-1`, `<prefix>-2`, and so on. */
export class SequentialIdGenerator implements IdGenerator {
  readonly #prefix: string;
  #counter = 0;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  next(): string {
    this.#counter += 1;
    return `${this.#prefix}-${this.#counter}`;
  }
}
