import { describe, expect, it } from 'vitest';
import { newBattleNetAccount, newTestAccount } from '../domain/account.ts';
import { PlayerName } from '../domain/player-name.ts';
import { createIsLinked } from './account-links.ts';
import { InMemoryAccountRepository } from './testing/in-memory-account-repository.ts';

function nameOf(raw: string) {
  const parsed = PlayerName.parse(raw);
  if (!parsed.ok) {
    throw new Error(`bad test name ${raw}`);
  }
  return parsed.value;
}

describe('isLinked (FR-31, INV-03)', () => {
  it('is false for an account that does not exist', async () => {
    const accounts = new InMemoryAccountRepository();
    expect(await createIsLinked({ accounts, stagingEndpoints: true })('nobody')).toBe(false);
  });

  it('is true for an account with a Battle.net account linked, whatever the staging setting', async () => {
    const accounts = new InMemoryAccountRepository();
    await accounts.insertBattleNetAccount(newBattleNetAccount('bnet-1', 'sub-1', 'Hero#1234'));
    expect(await createIsLinked({ accounts, stagingEndpoints: false })('bnet-1')).toBe(true);
  });

  it('is true for a test account while staging endpoints are on', async () => {
    const accounts = new InMemoryAccountRepository();
    await accounts.insertTestAccount(newTestAccount('test-1', nameOf('Alice')));
    expect(await createIsLinked({ accounts, stagingEndpoints: true })('test-1')).toBe(true);
  });

  it('is false for a test account once staging endpoints are off', async () => {
    const accounts = new InMemoryAccountRepository();
    await accounts.insertTestAccount(newTestAccount('test-1', nameOf('Alice')));
    expect(await createIsLinked({ accounts, stagingEndpoints: false })('test-1')).toBe(false);
  });
});
