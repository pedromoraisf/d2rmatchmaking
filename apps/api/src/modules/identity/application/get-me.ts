import { err, ok, withSpan, type Result } from '../../../shared-kernel/index.ts';
import type { AccountRepository } from './ports.ts';

export interface GetMeDeps {
  readonly accounts: AccountRepository;
}

export interface MeView {
  readonly accountId: string;
  readonly displayName: string;
}

/** The signed-in account. An account that no longer exists is `unauthenticated`. */
export function createGetMe(deps: GetMeDeps) {
  return (input: { readonly accountId: string }): Promise<Result<MeView, 'unauthenticated'>> =>
    withSpan('identity.get-me', {}, async (): Promise<Result<MeView, 'unauthenticated'>> => {
      const account = await deps.accounts.findById(input.accountId);
      if (account === null) {
        return err('unauthenticated');
      }
      return ok({ accountId: account.id, displayName: account.displayName });
    });
}
