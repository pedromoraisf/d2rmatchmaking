import { sql, type Kysely } from 'kysely';
import {
  parseCharacter,
  parseDeclaration,
  type Character,
  type Declaration,
} from '../../domain/character/character.ts';
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

/**
 * The declaration a stored row holds: both ladder and era, or neither until the player declares them (CHR-15). A row with
 * one of them and not the other is a bug, since only `declare` writes them.
 */
function declarationOf(row: { ladder: string | null; era: string | null }): Declaration | null {
  if (row.ladder === null && row.era === null) {
    return null;
  }
  const parsed = parseDeclaration({ ladder: row.ladder ?? '', era: row.era ?? '' });
  if (!parsed.ok) {
    throw new Error('a stored declaration breaks the character rules');
  }
  return parsed.value;
}

/**
 * Kysely CharacterRepository. A batch is one insert whose conflicts on (account, lower(name)) replace the reading's fields
 * and the row's spelling; the declared ladder and era are not in the update, so a reading never changes them.
 */
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
          hardcore: character.hardcore,
          // Ladder and era are declared on the site after the first reading (CHR-15).
          ladder: null,
          era: null,
          unlocked_difficulties: [...character.unlockedDifficulties],
          read_at: readAt,
        })),
      )
      .onConflict((conflict) =>
        // The unique index of migration 0007 is on the name without case; the row keeps the newest spelling. The declared
        // ladder and era are left out of the update on purpose.
        conflict.expression(sql`account_id, lower(name)`).doUpdateSet((eb) => ({
          name: eb.ref('excluded.name'),
          class: eb.ref('excluded.class'),
          level: eb.ref('excluded.level'),
          hardcore: eb.ref('excluded.hardcore'),
          unlocked_difficulties: eb.ref('excluded.unlocked_difficulties'),
          read_at: eb.ref('excluded.read_at'),
        })),
      )
      .execute();
  }

  async declare(accountId: string, characterId: string, declaration: Declaration): Promise<boolean> {
    const result = await this.#db
      .updateTable('identity.characters')
      .set({ ladder: declaration.ladder, era: declaration.era })
      .where('account_id', '=', accountId)
      .where('id', '=', characterId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  async listByAccount(accountId: string): Promise<StoredCharacter[]> {
    const rows = await this.#db
      .selectFrom('identity.characters')
      .select([
        'id',
        'name',
        'class',
        'level',
        'hardcore',
        'ladder',
        'era',
        'unlocked_difficulties',
        'read_at',
      ])
      .where('account_id', '=', accountId)
      .orderBy('name')
      .execute();
    return rows.map((row) => {
      // Only the upsert above writes the reading, and it writes what the domain accepted: a row that fails the rules is a bug.
      const parsed = parseCharacter({
        name: row.name,
        class: row.class,
        level: row.level,
        hardcore: row.hardcore,
        unlockedDifficulties: row.unlocked_difficulties,
      });
      if (!parsed.ok) {
        throw new Error('a stored character breaks the character rules');
      }
      const declaration = declarationOf(row);
      return {
        ...parsed.value,
        id: row.id,
        ladder: declaration?.ladder ?? null,
        era: declaration?.era ?? null,
        readAt: row.read_at,
      };
    });
  }
}
