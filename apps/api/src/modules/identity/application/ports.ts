import type { Account, BattleNetAccount } from '../domain/account.ts';
import type { Result } from '../../../shared-kernel/index.ts';

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

/** What Battle.net says about the signed-in player: the stable `sub` and the BattleTag (IDB-02). */
export interface BattleNetIdentity {
  readonly sub: string;
  readonly battletag: string;
}

/**
 * The Battle.net OAuth edge (IDB-01, IDB-02). The adapter in `adapters/bnet` makes the HTTP calls; the application never
 * sees a token, and no error it returns carries a code, a token or a secret (IDB-11).
 */
export interface BattleNetOAuth {
  /** The authorize URL with the client id, the redirect URI, scope `openid`, the state and the PKCE challenge. */
  authorizeUrl(input: {
    readonly state: string;
    readonly codeChallenge: string;
    readonly redirectUri: string;
  }): string;
  /** Exchanges the code with the PKCE verifier, then reads the userinfo of the access token. */
  exchange(input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }): Promise<Result<BattleNetIdentity, 'exchange-failed' | 'userinfo-failed'>>;
}
