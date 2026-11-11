import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { createCharacterOf } from './character-of.ts';
import { InMemoryCharacterRepository } from './testing/in-memory-character-repository.ts';

const START = new Date('2026-11-10T12:00:00.000Z');
const TX = {} as Transaction;

const sorc = {
  name: 'Sorc',
  class: 'sorceress' as const,
  level: 90,
  hardcore: false,
  unlockedDifficulties: ['normal', 'nightmare', 'hell'] as const,
};

/** Stores one character for `accountId` and returns its id as the repository holds it. */
async function storeSorc(characters: InMemoryCharacterRepository, accountId: string): Promise<string> {
  await characters.upsertMany(
    TX,
    accountId,
    [{ ...sorc, unlockedDifficulties: [...sorc.unlockedDifficulties] }],
    START,
  );
  const held = await characters.listByAccount(accountId);
  const id = held[0]?.id;
  if (id === undefined) {
    throw new Error('the character was not stored');
  }
  return id;
}

describe('characterOf (QUE-03)', () => {
  it('answers null for a character id the account does not hold', async () => {
    const characters = new InMemoryCharacterRepository();
    await storeSorc(characters, 'alice');
    const characterOf = createCharacterOf({ characters });
    expect(await characterOf('alice', 'no-such-character')).toBeNull();
  });

  it('answers null for a character that belongs to another account', async () => {
    const characters = new InMemoryCharacterRepository();
    const sorcId = await storeSorc(characters, 'alice');
    const characterOf = createCharacterOf({ characters });
    expect(await characterOf('bob', sorcId)).toBeNull();
  });

  it('answers the facts of the account’s character, with no declaration yet', async () => {
    const characters = new InMemoryCharacterRepository();
    const sorcId = await storeSorc(characters, 'alice');
    const characterOf = createCharacterOf({ characters });
    expect(await characterOf('alice', sorcId)).toStrictEqual({
      characterClass: 'sorceress',
      level: 90,
      hardcore: false,
      ladder: null,
      era: null,
      unlockedDifficulties: ['normal', 'nightmare', 'hell'],
    });
  });

  it('answers the ladder and era the player declared', async () => {
    const characters = new InMemoryCharacterRepository();
    const sorcId = await storeSorc(characters, 'alice');
    await characters.declare('alice', sorcId, { ladder: 'non-ladder', era: 'lod' });
    const characterOf = createCharacterOf({ characters });
    expect(await characterOf('alice', sorcId)).toMatchObject({ ladder: 'non-ladder', era: 'lod' });
  });
});
