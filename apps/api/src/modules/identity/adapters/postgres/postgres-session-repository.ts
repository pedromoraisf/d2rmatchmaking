import type { Kysely } from 'kysely';
import type { SessionRecord, SessionRepository } from '../../application/ports.ts';
import type { IdentityDatabase } from './schema.ts';

/** Kysely SessionRepository. Rows are keyed by the hash of the token; the plaintext token is never stored. */
export class PostgresSessionRepository implements SessionRepository {
  readonly #db: Kysely<IdentityDatabase>;

  constructor(db: Kysely<IdentityDatabase>) {
    this.#db = db;
  }

  async insert(record: SessionRecord & { readonly tokenHash: string }): Promise<void> {
    await this.#db
      .insertInto('identity.sessions')
      .values({
        token_hash: record.tokenHash,
        account_id: record.accountId,
        expires_at: record.expiresAt,
      })
      .execute();
  }

  async findByHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.#db
      .selectFrom('identity.sessions')
      .select(['account_id', 'expires_at'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row === undefined ? null : { accountId: row.account_id, expiresAt: row.expires_at };
  }
}
