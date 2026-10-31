import { describe, expect, it } from 'vitest';
import { isTestAccount, newTestAccount } from './account.ts';
import { PlayerName } from './player-name.ts';

const name = (raw: string): PlayerName => {
  const parsed = PlayerName.parse(raw);
  if (!parsed.ok) {
    throw new Error(`fixture name ${raw} is invalid`);
  }
  return parsed.value;
};

describe('newTestAccount', () => {
  it('gives a test account the battletag <display>#test and keeps the display name as typed', () => {
    const account = newTestAccount('account-1', name('PlayerOne'));

    expect(account).toEqual({
      id: 'account-1',
      battletag: 'PlayerOne#test',
      displayName: 'PlayerOne',
      testKey: 'playerone',
    });
  });

  it('is a test account', () => {
    expect(isTestAccount(newTestAccount('account-1', name('PlayerOne')))).toBe(true);
  });
});

describe('isTestAccount', () => {
  it('is false for an account without a test key', () => {
    expect(isTestAccount({ id: 'account-2', battletag: 'Someone#1234', displayName: 'Someone' })).toBe(false);
  });
});
