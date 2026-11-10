import type { Clock, IdGenerator, RandomSource } from '../../../shared-kernel/index.ts';
import { createAuthenticateSession } from './authenticate-session.ts';
import { createGetMe } from './get-me.ts';
import type { AccountRepository, SecretHasher, SessionRepository } from './ports.ts';
import { createSignInTestAccount } from './sign-in-test-account.ts';
import { createSignOut } from './sign-out.ts';

export interface IdentityDeps {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
}

/** Builds the Identity use cases over their ports. */
export function createIdentityUseCases(deps: IdentityDeps) {
  return {
    signInTestAccount: createSignInTestAccount(deps),
    authenticateSession: createAuthenticateSession(deps),
    getMe: createGetMe(deps),
    signOut: createSignOut(deps),
  };
}

export type IdentityUseCases = ReturnType<typeof createIdentityUseCases>;
