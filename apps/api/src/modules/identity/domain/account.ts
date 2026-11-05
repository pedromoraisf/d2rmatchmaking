import type { PlayerName } from './player-name.ts';

const TEST_BATTLETAG_SUFFIX = '#test';

/** An account. Test accounts carry a `testKey` and a battletag of `<display>#test` (AD-042). */
export interface Account {
  readonly id: string;
  readonly battletag: string;
  readonly displayName: string;
  readonly testKey?: string;
}

/** Builds the test account for a player name. */
export function newTestAccount(id: string, name: PlayerName): Account {
  return {
    id,
    battletag: `${name.value}${TEST_BATTLETAG_SUFFIX}`,
    displayName: name.value,
    testKey: name.testKey,
  };
}

/** True only for accounts created by the test sign-in. */
export function isTestAccount(account: Account): boolean {
  return account.battletag.endsWith(TEST_BATTLETAG_SUFFIX) && account.testKey !== undefined;
}
