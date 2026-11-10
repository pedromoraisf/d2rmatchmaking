import {
  newBattleNetAccount,
  displayNameOf,
  type Account,
  type BattleNetAccount,
} from '../domain/account.ts';
import { Session } from '../domain/session.ts';
import {
  err,
  ok,
  withSpan,
  type Clock,
  type IdGenerator,
  type RandomSource,
  type Result,
} from '../../../shared-kernel/index.ts';
import type { AccountRepository, BattleNetOAuth, SecretHasher, SessionRepository } from './ports.ts';
import { newSessionToken } from './session-token.ts';

export interface SignInWithBattleNetDeps {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
  readonly battleNet: BattleNetOAuth;
}

export interface BattleNetSignIn {
  readonly accountId: string;
  readonly displayName: string;
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

export type BattleNetSignInFailure = 'exchange-failed' | 'userinfo-failed';

/**
 * Exchanges the callback's code, then finds the account by the Battle.net `sub` or creates it on the first sign-in. A
 * changed BattleTag is stored on the same account (IDB-03). Opens a 7-day session (IDB-02). Opens no session on failure.
 */
export function createSignInWithBattleNet(deps: SignInWithBattleNetDeps) {
  return (input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }): Promise<Result<BattleNetSignIn, BattleNetSignInFailure>> =>
    withSpan(
      'identity.sign-in-battle-net',
      {},
      async (): Promise<Result<BattleNetSignIn, BattleNetSignInFailure>> => {
        const exchanged = await deps.battleNet.exchange(input);
        if (!exchanged.ok) {
          return err(exchanged.error);
        }
        const { sub, battletag } = exchanged.value;
        const account = await accountForSignIn(deps, sub, battletag);
        const session = Session.open(account.id, deps.clock.now());
        const sessionToken = newSessionToken(deps.random);
        await deps.sessions.insert({
          tokenHash: deps.hasher.hash('session', sessionToken),
          accountId: account.id,
          expiresAt: session.expiresAt,
        });
        return ok({
          accountId: account.id,
          displayName: account.displayName,
          sessionToken,
          expiresAt: session.expiresAt,
        });
      },
    );
}

/** The account of a Battle.net `sub`: found (with a changed BattleTag stored) or created on the first sign-in. */
async function accountForSignIn(
  deps: SignInWithBattleNetDeps,
  sub: string,
  battletag: string,
): Promise<Account> {
  const existing = await deps.accounts.findByBnetSub(sub);
  if (existing !== null) {
    return withBattletag(deps, existing, battletag);
  }
  const created: BattleNetAccount = newBattleNetAccount(deps.ids.next(), sub, battletag);
  try {
    await deps.accounts.insertBattleNetAccount(created);
  } catch (error) {
    // Two first sign-ins of one account at once: the other insert won the unique `bnet_sub`. Read that account; when
    // none exists the failure is not a race and is rethrown.
    const winner = await deps.accounts.findByBnetSub(sub);
    if (winner === null) {
      throw error;
    }
    return withBattletag(deps, winner, battletag);
  }
  return created;
}

/** A found account: a changed BattleTag is stored on the same account (IDB-03). */
async function withBattletag(
  deps: SignInWithBattleNetDeps,
  existing: Account,
  battletag: string,
): Promise<Account> {
  if (existing.battletag === battletag) {
    return existing;
  }
  const displayName = displayNameOf(battletag);
  await deps.accounts.updateBattletag(existing.id, battletag, displayName);
  return { ...existing, battletag, displayName };
}
