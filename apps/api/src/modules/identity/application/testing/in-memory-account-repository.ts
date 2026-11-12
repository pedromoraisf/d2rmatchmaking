import type { Account, BattleNetAccount } from '../../domain/account.ts';
import { isTestAccount } from '../../domain/account.ts';
import type { AccountRepository } from '../ports.ts';

/** In-memory AccountRepository. `findTestAccount` only ever returns test accounts, as the Postgres query does. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly #accounts = new Map<string, Account>();

  async findTestAccount(testKey: string): Promise<Account | null> {
    for (const account of this.#accounts.values()) {
      if (isTestAccount(account) && account.testKey === testKey) {
        return { ...account };
      }
    }
    return null;
  }

  async findById(accountId: string): Promise<Account | null> {
    const account = this.#accounts.get(accountId);
    return account === undefined ? null : { ...account };
  }

  async insertTestAccount(account: Account): Promise<void> {
    this.#accounts.set(account.id, { ...account });
  }

  async findByBnetSub(bnetSub: string): Promise<Account | null> {
    for (const account of this.#accounts.values()) {
      if (account.bnetSub === bnetSub) {
        return { ...account };
      }
    }
    return null;
  }

  async insertBattleNetAccount(account: BattleNetAccount): Promise<void> {
    this.#accounts.set(account.id, { ...account });
  }

  async updateBattletag(accountId: string, battletag: string, displayName: string): Promise<void> {
    const account = this.#accounts.get(accountId);
    if (account !== undefined) {
      this.#accounts.set(accountId, { ...account, battletag, displayName });
    }
  }

  /** Test helper: stores an account of any kind, for example a non-test account. */
  seed(account: Account): void {
    this.#accounts.set(account.id, { ...account });
  }
}
