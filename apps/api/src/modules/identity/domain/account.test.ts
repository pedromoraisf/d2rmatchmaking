import { describe, expect, it } from 'vitest';
import { displayNameOf, isTestAccount, newBattleNetAccount, newTestAccount } from './account.ts';
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

describe('displayNameOf', () => {
  it('is the name part of a BattleTag, without its number', () => {
    expect(displayNameOf('Alice#1234')).toBe('Alice');
    expect(displayNameOf('Alicia#5678')).toBe('Alicia');
  });

  it('is the whole value when there is no number to cut', () => {
    expect(displayNameOf('NoNumber')).toBe('NoNumber');
  });

  it('is empty when the BattleTag starts at its number', () => {
    expect(displayNameOf('#1234')).toBe('');
  });
});

describe('newBattleNetAccount', () => {
  it('takes the sub, the BattleTag and its name part, and carries no test key', () => {
    const account = newBattleNetAccount('account-5', 'sub-alice', 'Alice#1234');

    expect(account).toEqual({
      id: 'account-5',
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-alice',
    });
    expect(isTestAccount(account)).toBe(false);
  });
});

describe('isTestAccount', () => {
  it('is false for an account without a test key', () => {
    expect(isTestAccount({ id: 'account-2', battletag: 'Someone#1234', displayName: 'Someone' })).toBe(false);
  });
});

describe('isTestAccount needs both the #test battletag and the test key', () => {
  it('is false for a #test battletag without a test key', () => {
    expect(isTestAccount({ id: 'account-3', battletag: 'Ghost#test', displayName: 'Ghost' })).toBe(false);
  });

  it('is false for a test key without the #test battletag', () => {
    expect(
      isTestAccount({
        id: 'account-4',
        battletag: 'Someone#1234',
        displayName: 'Someone',
        testKey: 'someone',
      }),
    ).toBe(false);
  });
});
