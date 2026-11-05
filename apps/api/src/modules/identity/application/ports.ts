import type { Account } from '../domain/account.ts';

/** Which table a secret belongs to: a value hashed for one domain never matches another (design.md § Identity). */
export type SecretDomain = 'session' | 'agent' | 'claim';

/** Test accounts only: `findTestAccount` never returns an account without a test key. */
export interface AccountRepository {
  findTestAccount(testKey: string): Promise<Account | null>;
  findById(accountId: string): Promise<Account | null>;
  insertTestAccount(account: Account): Promise<void>;
}

export interface SessionRecord {
  readonly accountId: string;
  readonly expiresAt: Date;
}

/** Stores sessions by the hash of their token; the plaintext token is never stored. */
export interface SessionRepository {
  insert(record: SessionRecord & { readonly tokenHash: string }): Promise<void>;
  findByHash(tokenHash: string): Promise<SessionRecord | null>;
}

export interface SecretHasher {
  hash(domain: SecretDomain, value: string): string;
}
