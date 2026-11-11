import type { Character } from '../../domain/character/character.ts';
import type { CharacterRepository, StoredCharacter } from '../character-ports.ts';
import type { Transaction } from '../../../../shared-kernel/index.ts';

/** In-memory CharacterRepository keyed by account and name, as the Postgres unique key is. */
export class InMemoryCharacterRepository implements CharacterRepository {
  readonly #rows = new Map<string, { readonly accountId: string; readonly character: StoredCharacter }>();

  async lockAccount(): Promise<void> {
    // One writer at a time in memory: nothing to lock.
  }

  async storedNames(_tx: Transaction, accountId: string): Promise<readonly string[]> {
    return [...this.#rows.values()]
      .filter((row) => row.accountId === accountId)
      .map((row) => row.character.name);
  }

  async upsertMany(
    _tx: Transaction,
    accountId: string,
    characters: readonly Character[],
    readAt: Date,
  ): Promise<void> {
    for (const character of characters) {
      this.#rows.set(keyOf(accountId, character.name), {
        accountId,
        character: {
          ...character,
          unlockedDifficulties: [...character.unlockedDifficulties],
          readAt: new Date(readAt),
        },
      });
    }
  }

  async listByAccount(accountId: string): Promise<StoredCharacter[]> {
    return [...this.#rows.values()]
      .filter((row) => row.accountId === accountId)
      .map((row) => ({ ...row.character, unlockedDifficulties: [...row.character.unlockedDifficulties] }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

function keyOf(accountId: string, name: string): string {
  return `${accountId}\u0000${name}`;
}
