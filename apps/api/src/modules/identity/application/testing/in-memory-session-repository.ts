import type { SessionRecord, SessionRepository } from '../ports.ts';

/** In-memory SessionRepository keyed by the token hash. */
export class InMemorySessionRepository implements SessionRepository {
  readonly #rows = new Map<string, SessionRecord>();

  async insert(record: SessionRecord & { readonly tokenHash: string }): Promise<void> {
    this.#rows.set(record.tokenHash, {
      accountId: record.accountId,
      expiresAt: new Date(record.expiresAt.getTime()),
    });
  }

  async findByHash(tokenHash: string): Promise<SessionRecord | null> {
    const record = this.#rows.get(tokenHash);
    return record === undefined
      ? null
      : { accountId: record.accountId, expiresAt: new Date(record.expiresAt.getTime()) };
  }

  async delete(tokenHash: string): Promise<void> {
    this.#rows.delete(tokenHash);
  }

  /** Test helper: the hashes that are stored, never the tokens. */
  storedHashes(): string[] {
    return [...this.#rows.keys()];
  }
}
