import { PlayerName } from '../domain/player-name.ts';
import { newTestAccount } from '../domain/account.ts';
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
import type { AccountRepository, SecretHasher, SessionRepository } from './ports.ts';
import { newSessionToken } from './session-token.ts';

export interface SignInTestAccountDeps {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
}

export interface SignInResult {
  readonly accountId: string;
  readonly displayName: string;
  readonly sessionToken: string;
  readonly expiresAt: Date;
}

/** Finds the test account for the name, ignoring case, or creates it; then opens a session for it. */
export function createSignInTestAccount(deps: SignInTestAccountDeps) {
  return (input: { readonly name: string }): Promise<Result<SignInResult, 'invalid-name'>> =>
    withSpan('identity.sign-in-test-account', {}, async (): Promise<Result<SignInResult, 'invalid-name'>> => {
      const parsed = PlayerName.parse(input.name);
      if (!parsed.ok) {
        return err('invalid-name');
      }
      let account = await deps.accounts.findTestAccount(parsed.value.testKey);
      if (account === null) {
        account = newTestAccount(deps.ids.next(), parsed.value);
        await deps.accounts.insertTestAccount(account);
      }
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
    });
}
