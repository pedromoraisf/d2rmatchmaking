import type { CharacterClassName } from '../../../../shared-kernel/index.ts';
import type { RoomCharacters } from '../ports.ts';

/** RoomCharacters that knows the characters a test registers. */
export class FakeRoomCharacters implements RoomCharacters {
  readonly #known = new Map<string, { characterClass: CharacterClassName; level: number }>();

  add(accountId: string, characterId: string, characterClass: CharacterClassName, level: number): void {
    this.#known.set(`${accountId}:${characterId}`, { characterClass, level });
  }

  async characterOf(accountId: string, characterId: string) {
    return this.#known.get(`${accountId}:${characterId}`) ?? null;
  }
}
