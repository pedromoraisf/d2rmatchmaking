import type { Character, Declaration, DeclaredLadder, Era } from '../domain/character/character.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';

/**
 * A character as stored: the reading that last replaced it, when it was read (CHR-09, CHR-11), and the ladder and era the
 * player declared, null until a declaration (CHR-15).
 */
export interface StoredCharacter extends Character {
  readonly id: string;
  readonly ladder: DeclaredLadder | null;
  readonly era: Era | null;
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
  /**
   * Creates each character or replaces its reading with this one, in the caller's transaction. A replaced character keeps
   * the ladder and era the player declared (CHR-15).
   */
  upsertMany(
    tx: Transaction,
    accountId: string,
    characters: readonly Character[],
    readAt: Date,
  ): Promise<void>;
  /** Sets the ladder and era of one of the account's characters; false when the account holds no such character (CHR-16). */
  declare(accountId: string, characterId: string, declaration: Declaration): Promise<boolean>;
  /** The account's characters, ordered by name. */
  listByAccount(accountId: string): Promise<StoredCharacter[]>;
}
