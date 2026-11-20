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

describe('characterNamesOf (SNM-03)', () => {
  it('answers the stored spelling of each pair in one call, null for a pair the account does not hold', async () => {
    const useCases = createCharacterUseCases({
      characters: new InMemoryCharacterRepository(),
      uow: new InMemoryUnitOfWork(),
      outbox: new RecordingOutbox(),
      clock: new FakeClock(new Date('2026-11-10T12:00:00.000Z')),
    });
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    await useCases.recordCharacters({ accountId: 'bob', characters: [{ ...sorc, name: 'Hammer' }] });
    const [alicesCharacter] = await useCases.listMyCharacters({ accountId: 'alice' });
    const [bobsCharacter] = await useCases.listMyCharacters({ accountId: 'bob' });

    const names = await useCases.characterNamesOf([
      { accountId: 'alice', characterId: alicesCharacter?.id ?? '' },
      { accountId: 'bob', characterId: bobsCharacter?.id ?? '' },
      { accountId: 'bob', characterId: alicesCharacter?.id ?? '' },
      { accountId: 'alice', characterId: 'nope' },
    ]);

    expect(names).toEqual(['Sorc', 'Hammer', null, null]);
    expect(await useCases.characterNamesOf([])).toEqual([]);
  });
});
