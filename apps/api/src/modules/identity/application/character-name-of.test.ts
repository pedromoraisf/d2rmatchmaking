import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { createCharacterUseCases } from './character-use-cases.ts';
import { InMemoryCharacterRepository } from './testing/in-memory-character-repository.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const sorc = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  hardcore: false,
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

describe('characterNameOf (SNM-03)', () => {
  it('answers the stored spelling of the account’s own character, and null for any other', async () => {
    const useCases = createCharacterUseCases({
      characters: new InMemoryCharacterRepository(),
      uow: new InMemoryUnitOfWork(),
      outbox: new RecordingOutbox(),
      clock: new FakeClock(new Date('2026-11-10T12:00:00.000Z')),
    });
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    const [stored] = await useCases.listMyCharacters({ accountId: 'alice' });

    expect(await useCases.characterNameOf('alice', stored?.id ?? '')).toBe('Sorc');
    expect(await useCases.characterNameOf('bob', stored?.id ?? '')).toBeNull();
    expect(await useCases.characterNameOf('alice', 'nope')).toBeNull();
  });
});
