import { randomUUID } from 'node:crypto';
import { characterKey, type Character, type Declaration } from '../../domain/character/character.ts';
import type { CharacterRepository, StoredCharacter } from '../character-ports.ts';
import type { Transaction } from '../../../../shared-kernel/index.ts';

/**
 * In-memory CharacterRepository keyed by account and name without case, as the Postgres unique index is. A replaced
 * reading keeps the row's id and the ladder and era the player declared, as the upsert does.
 */
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
      const key = keyOf(accountId, character.name);
      const existing = this.#rows.get(key)?.character;
      this.#rows.set(key, {
        accountId,
        character: {
          id: existing?.id ?? randomUUID(),
          // The row keeps the newest spelling of the name, and the declaration the player made.
          name: character.name,
          class: character.class,
          level: character.level,
          hardcore: character.hardcore,
          unlockedDifficulties: [...character.unlockedDifficulties],
          ladder: existing?.ladder ?? null,
          era: existing?.era ?? null,
          readAt: new Date(readAt),
        },
      });
    }
  }

  async declare(accountId: string, characterId: string, declaration: Declaration): Promise<boolean> {
    for (const [key, row] of this.#rows) {
      if (row.accountId === accountId && row.character.id === characterId) {
        this.#rows.set(key, {
          accountId,
          character: { ...row.character, ladder: declaration.ladder, era: declaration.era },
        });
        return true;
      }
    }
    return false;
  }

  async listByAccount(accountId: string): Promise<StoredCharacter[]> {
    return [...this.#rows.values()]
      .filter((row) => row.accountId === accountId)
      .map((row) => ({ ...row.character, unlockedDifficulties: [...row.character.unlockedDifficulties] }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

function keyOf(accountId: string, name: string): string {
  return `${accountId}\u0000${characterKey(name)}`;
}
