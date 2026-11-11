import type { Kysely } from 'kysely';
import { parseCharacter, type Character } from '../../domain/character/character.ts';
import type { CharacterRepository, StoredCharacter } from '../../application/character-ports.ts';
import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { IdentityDatabase } from './schema.ts';

/**
 * The Kysely transaction behind the opaque `Transaction` the platform's unit of work opened. Modules may not import
 * platform/, so the cast is repeated here; it is sound because only that unit of work creates tokens.
 */
function executorOf(tx: Transaction): Kysely<IdentityDatabase> {
  return tx as unknown as Kysely<IdentityDatabase>;
}

/** Kysely CharacterRepository. A batch is one insert whose conflicts on (account, name) replace the row's fields. */
export class PostgresCharacterRepository implements CharacterRepository {
  readonly #db: Kysely<IdentityDatabase>;

  constructor(db: Kysely<IdentityDatabase>) {
    this.#db = db;
  }

  async lockAccount(tx: Transaction, accountId: string): Promise<void> {
    // The account row is the lock: two batches of one account wait for each other until their transactions end.
    await executorOf(tx)
      .selectFrom('identity.accounts')
      .select('id')
      .where('id', '=', accountId)
      .forUpdate()
      .execute();
  }

  async storedNames(tx: Transaction, accountId: string): Promise<readonly string[]> {
    const rows = await executorOf(tx)
      .selectFrom('identity.characters')
      .select('name')
      .where('account_id', '=', accountId)
      .execute();
    return rows.map((row) => row.name);
  }

  async upsertMany(
    tx: Transaction,
    accountId: string,
    characters: readonly Character[],
    readAt: Date,
  ): Promise<void> {
    if (characters.length === 0) {
      return;
    }
    await executorOf(tx)
      .insertInto('identity.characters')
      .values(
        characters.map((character) => ({
          account_id: accountId,
          name: character.name,
          class: character.class,
          level: character.level,
          ladder: character.ladder,
          era: character.era,
          unlocked_difficulties: [...character.unlockedDifficulties],
          read_at: readAt,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['account_id', 'name']).doUpdateSet((eb) => ({
          class: eb.ref('excluded.class'),
          level: eb.ref('excluded.level'),
          ladder: eb.ref('excluded.ladder'),
          era: eb.ref('excluded.era'),
          unlocked_difficulties: eb.ref('excluded.unlocked_difficulties'),
          read_at: eb.ref('excluded.read_at'),
        })),
      )
      .execute();
  }

  async listByAccount(accountId: string): Promise<StoredCharacter[]> {
    const rows = await this.#db
      .selectFrom('identity.characters')
      .select(['name', 'class', 'level', 'ladder', 'era', 'unlocked_difficulties', 'read_at'])
      .where('account_id', '=', accountId)
      .orderBy('name')
      .execute();
    return rows.map((row) => {
      // Only the upsert above writes this table, and it writes what the domain accepted: a row that fails the rules is a bug.
      const parsed = parseCharacter({
        name: row.name,
        class: row.class,
        level: row.level,
        ladder: row.ladder,
        era: row.era,
        unlockedDifficulties: row.unlocked_difficulties,
      });
      if (!parsed.ok) {
        throw new Error('a stored character breaks the character rules');
      }
      return { ...parsed.value, readAt: row.read_at };
    });
  }
}
