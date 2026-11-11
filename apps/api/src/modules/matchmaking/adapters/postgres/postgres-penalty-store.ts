import type { Kysely } from 'kysely';
import type { PenaltyStore } from '../../application/ports.ts';
import type { MatchmakingDatabase } from './schema.ts';

/**
 * The penalties in `matchmaking.penalties` (RDY-05, RDY-09): one row per account, so a restart keeps every wait. A new
 * penalty replaces the account's row.
 */
export class PostgresPenaltyStore implements PenaltyStore {
  readonly #db: Kysely<MatchmakingDatabase>;

  constructor(db: Kysely<MatchmakingDatabase>) {
    this.#db = db;
  }

  async untilOf(accountId: string): Promise<Date | undefined> {
    const row = await this.#db
      .selectFrom('matchmaking.penalties')
      .select('until')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row === undefined ? undefined : new Date(row.until);
  }

  async record(accountIds: readonly string[], until: Date, reason: 'ready-check-timeout'): Promise<void> {
    if (accountIds.length === 0) {
      return;
    }
    await this.#db
      .insertInto('matchmaking.penalties')
      .values(accountIds.map((accountId) => ({ account_id: accountId, reason, until })))
      .onConflict((conflict) =>
        conflict.column('account_id').doUpdateSet({
          reason: (eb) => eb.ref('excluded.reason'),
          until: (eb) => eb.ref('excluded.until'),
        }),
      )
      .execute();
  }
}
