import type { GameNameSequence } from '../ports.ts';

/** Counts from 1, like a fresh `lobby.game_name_seq`. */
export class InMemoryGameNameSequence implements GameNameSequence {
  #last = 0;

  async next(): Promise<number> {
    this.#last += 1;
    return this.#last;
  }
}
