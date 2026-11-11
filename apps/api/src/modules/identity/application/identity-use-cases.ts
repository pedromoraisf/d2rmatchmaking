import type { Clock, IdGenerator, RandomSource } from '../../../shared-kernel/index.ts';
import { createIsLinked } from './account-links.ts';
import { createAuthenticateSession } from './authenticate-session.ts';
import { createGetMe } from './get-me.ts';
import type { AccountRepository, BattleNetOAuth, SecretHasher, SessionRepository } from './ports.ts';
import { createSignInTestAccount } from './sign-in-test-account.ts';
import { createSignInWithBattleNet } from './sign-in-with-battle-net.ts';
import { createSignOut } from './sign-out.ts';

export interface IdentityDeps {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
  /** The Battle.net OAuth edge: the real adapter when the credentials are configured, otherwise a refusing stand-in. */
  readonly battleNet: BattleNetOAuth;
  /** Whether test accounts count as linked (staging endpoints). Off by default. */
  readonly stagingEndpoints?: boolean;
}

/** Builds the Identity use cases over their ports. */
export function createIdentityUseCases(deps: IdentityDeps) {
  return {
    signInTestAccount: createSignInTestAccount(deps),
    signInWithBattleNet: createSignInWithBattleNet(deps),
    authenticateSession: createAuthenticateSession(deps),
    getMe: createGetMe(deps),
    signOut: createSignOut(deps),
    isLinked: createIsLinked({ accounts: deps.accounts, stagingEndpoints: deps.stagingEndpoints ?? false }),
  };
}

export type IdentityUseCases = ReturnType<typeof createIdentityUseCases>;
