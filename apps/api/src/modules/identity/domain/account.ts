import type { PlayerName } from './player-name.ts';

const TEST_BATTLETAG_SUFFIX = '#test';

/** An account. Test accounts carry a `testKey` and a battletag of `<display>#test` (AD-042). */
export interface Account {
  readonly id: string;
  readonly battletag: string;
  readonly displayName: string;
  readonly testKey?: string;
  /** The Battle.net `sub`, the stable identifier of a Battle.net account (IDB-03). Absent on test accounts. */
  readonly bnetSub?: string;
}

/** An account created by Battle.net sign-in: it always has its `sub`. */
export interface BattleNetAccount extends Account {
  readonly bnetSub: string;
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

/**
 * The display name of a BattleTag: its name part (`Name#1234` → `Name`). The number is never shown; the full BattleTag
 * is stored, and never sent to telemetry (IDB-11).
 */
export function displayNameOf(battletag: string): string {
  const separator = battletag.indexOf('#');
  return separator < 0 ? battletag : battletag.slice(0, separator);
}

/** A new account of the first Battle.net sign-in: its stable `sub`, its BattleTag and the display name (IDB-02). */
export function newBattleNetAccount(id: string, bnetSub: string, battletag: string): BattleNetAccount {
  return { id, battletag, displayName: displayNameOf(battletag), bnetSub };
}

/** True only for accounts created by the test sign-in. */
export function isTestAccount(account: Account): boolean {
  return account.battletag.endsWith(TEST_BATTLETAG_SUFFIX) && account.testKey !== undefined;
}
