import type { CharacterClassName } from '../../../../shared-kernel/index.ts';
import type { RoomCharacters } from '../ports.ts';

/** RoomCharacters that knows the characters a test registers. */
export class FakeRoomCharacters implements RoomCharacters {
  readonly #known = new Map<string, { characterClass: CharacterClassName; level: number }>();
  readonly #names = new Map<string, string>();

  add(
    accountId: string,
    characterId: string,
    characterClass: CharacterClassName,
    level: number,
    name?: string,
  ): void {
    this.#known.set(`${accountId}:${characterId}`, { characterClass, level });
    if (name !== undefined) {
      this.#names.set(`${accountId}:${characterId}`, name);
    }
  }

  async nameOf(accountId: string, characterId: string): Promise<string | null> {
    return this.#names.get(`${accountId}:${characterId}`) ?? null;
  }

  async characterOf(accountId: string, characterId: string) {
    return this.#known.get(`${accountId}:${characterId}`) ?? null;
  }
}
