import type { Kysely } from 'kysely';
import type { Clock } from '../../../../shared-kernel/index.ts';
import type { Account, BattleNetAccount } from '../../domain/account.ts';
import type { AccountRepository } from '../../application/ports.ts';
import type { IdentityDatabase } from './schema.ts';

interface AccountRow {
  readonly id: string;
  readonly battletag: string;
  readonly display_name: string;
  readonly test_key: string | null;
  readonly bnet_sub: string | null;
}

/**
 * Maps a row to the domain account. `testKey` and `bnetSub` are absent (not undefined) for the accounts that have
 * none.
 */
function toAccount(row: AccountRow): Account {
  const base = { id: row.id, battletag: row.battletag, displayName: row.display_name };
  const withTestKey = row.test_key === null ? base : { ...base, testKey: row.test_key };
  return row.bnet_sub === null ? withTestKey : { ...withTestKey, bnetSub: row.bnet_sub };
}

/** Kysely AccountRepository. Only test accounts carry a `test_key`, so `findTestAccount` can never return another. */
export class PostgresAccountRepository implements AccountRepository {
  readonly #db: Kysely<IdentityDatabase>;
  readonly #clock: Clock;

  constructor(db: Kysely<IdentityDatabase>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async findTestAccount(testKey: string): Promise<Account | null> {
    const row = await this.#db
      .selectFrom('identity.accounts')
      .select(['id', 'battletag', 'display_name', 'test_key', 'bnet_sub'])
      .where('test_key', '=', testKey)
      .executeTakeFirst();
    return row === undefined ? null : toAccount(row);
  }

  async findById(accountId: string): Promise<Account | null> {
    const row = await this.#db
      .selectFrom('identity.accounts')
      .select(['id', 'battletag', 'display_name', 'test_key', 'bnet_sub'])
      .where('id', '=', accountId)
      .executeTakeFirst();
    return row === undefined ? null : toAccount(row);
  }

  async insertTestAccount(account: Account): Promise<void> {
    await this.#db
      .insertInto('identity.accounts')
      .values({
        id: account.id,
        battletag: account.battletag,
        display_name: account.displayName,
        test_key: account.testKey ?? null,
        bnet_sub: null,
        created_at: this.#clock.now(),
      })
      .execute();
  }

  async findByBnetSub(bnetSub: string): Promise<Account | null> {
    const row = await this.#db
      .selectFrom('identity.accounts')
      .select(['id', 'battletag', 'display_name', 'test_key', 'bnet_sub'])
      .where('bnet_sub', '=', bnetSub)
      .executeTakeFirst();
    return row === undefined ? null : toAccount(row);
  }

  async insertBattleNetAccount(account: BattleNetAccount): Promise<void> {
    await this.#db
      .insertInto('identity.accounts')
      .values({
        id: account.id,
        battletag: account.battletag,
        display_name: account.displayName,
        test_key: null,
        bnet_sub: account.bnetSub,
        created_at: this.#clock.now(),
      })
      .execute();
  }

  async updateBattletag(accountId: string, battletag: string, displayName: string): Promise<void> {
    await this.#db
      .updateTable('identity.accounts')
      .set({ battletag, display_name: displayName })
      .where('id', '=', accountId)
      .execute();
  }
}
