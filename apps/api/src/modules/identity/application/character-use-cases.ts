import type { Clock, Outbox, UnitOfWork } from '../../../shared-kernel/index.ts';
import { createDeclareCharacter } from './declare-character.ts';
import { createListMyCharacters } from './list-my-characters.ts';
import type { CharacterRepository } from './character-ports.ts';
import { createRecordCharacters } from './record-characters.ts';

export interface CharacterUseCasesDeps {
  readonly characters: CharacterRepository;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly clock: Clock;
}

/** Builds the character use cases over their ports. */
export function createCharacterUseCases(deps: CharacterUseCasesDeps) {
  return {
    recordCharacters: createRecordCharacters(deps),
    listMyCharacters: createListMyCharacters(deps),
    declareCharacter: createDeclareCharacter(deps),
  };
}

export type CharacterUseCases = ReturnType<typeof createCharacterUseCases>;
