import { isTestAccount } from '../domain/account.ts';
import { withSpan } from '../../../shared-kernel/index.ts';
import type { AccountRepository } from './ports.ts';

export interface IsLinkedDeps {
  readonly accounts: AccountRepository;
  /** Test accounts count as linked only while staging endpoints are on (QUE-05, spec decision AD-029). */
  readonly stagingEndpoints: boolean;
}

/**
 * True when the account has a Battle.net account linked (its `sub`), or is a test account and staging endpoints are on.
 * A queue needs one of the two (FR-31, INV-03).
 */
export function createIsLinked(deps: IsLinkedDeps) {
  return (accountId: string): Promise<boolean> =>
    withSpan('identity.is-linked', {}, async (): Promise<boolean> => {
      const account = await deps.accounts.findById(accountId);
      if (account === null) {
        return false;
      }
      if (account.bnetSub !== undefined) {
        return true;
      }
      return deps.stagingEndpoints && isTestAccount(account);
    });
}
