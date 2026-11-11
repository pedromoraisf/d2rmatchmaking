import type { Character } from '../domain/character/character.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';

/** A character as stored: the reading that last replaced it and when it was read (CHR-09, CHR-11). */
export interface StoredCharacter extends Character {
  readonly readAt: Date;
}

/** Characters keyed by account and name (design.md § Identity module, CHR-09). */
export interface CharacterRepository {
  /**
   * Serializes the batches of one account until the caller's transaction ends, so the account limit (security finding 2)
   * holds when two agents post at once.
   */
  lockAccount(tx: Transaction, accountId: string): Promise<void>;
  /** The names the account holds now, read in the caller's transaction. */
  storedNames(tx: Transaction, accountId: string): Promise<readonly string[]>;
  /** Creates each character or replaces its fields with this reading, in the caller's transaction. */
  upsertMany(
    tx: Transaction,
    accountId: string,
    characters: readonly Character[],
    readAt: Date,
  ): Promise<void>;
  /** The account's characters, ordered by name. */
  listByAccount(accountId: string): Promise<StoredCharacter[]>;
}
