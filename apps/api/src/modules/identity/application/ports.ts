import type { Account, BattleNetAccount } from '../domain/account.ts';

/** Which table a secret belongs to: a value hashed for one domain never matches another (design.md § Identity). */
export type SecretDomain = 'session' | 'agent' | 'claim';

/** Test accounts only: `findTestAccount` never returns an account without a test key. */
export interface AccountRepository {
  findTestAccount(testKey: string): Promise<Account | null>;
  findById(accountId: string): Promise<Account | null>;
  insertTestAccount(account: Account): Promise<void>;
  /** The Battle.net account with this `sub`, or null. The BattleTag is never used to find an account (IDB-03). */
  findByBnetSub(bnetSub: string): Promise<Account | null>;
  insertBattleNetAccount(account: BattleNetAccount): Promise<void>;
  /** Stores a changed BattleTag and display name of the same account (IDB-03). */
  updateBattletag(accountId: string, battletag: string, displayName: string): Promise<void>;
}

export interface SessionRecord {
  readonly accountId: string;
  readonly expiresAt: Date;
}

/** Stores sessions by the hash of their token; the plaintext token is never stored. */
export interface SessionRepository {
  insert(record: SessionRecord & { readonly tokenHash: string }): Promise<void>;
  findByHash(tokenHash: string): Promise<SessionRecord | null>;
  /** Deletes the session with this token hash; a missing session is not an error (IDB-05). */
  delete(tokenHash: string): Promise<void>;
}

export interface SecretHasher {
  hash(domain: SecretDomain, value: string): string;
}
