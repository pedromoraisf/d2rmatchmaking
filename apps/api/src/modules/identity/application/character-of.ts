import type { Era, CharacterClass, DeclaredLadder, Difficulty } from '../domain/character/character.ts';
import { withSpan } from '../../../shared-kernel/index.ts';
import type { CharacterRepository } from './character-ports.ts';

/**
 * The facts of one character a queue join reads (QUE-03): its class (the ready check's mark, RDY-01), level, mode,
 * declaration and unlocked difficulties.
 */
export interface CharacterFacts {
  readonly characterClass: CharacterClass;
  readonly level: number;
  readonly hardcore: boolean;
  readonly ladder: DeclaredLadder | null;
  readonly era: Era | null;
  readonly unlockedDifficulties: readonly Difficulty[];
}

export interface CharacterOfDeps {
  readonly characters: CharacterRepository;
}

/**
 * The account's character with this id, or null when the account holds no such character (QUE-03: a character that is not
 * the player's is refused). The span carries no name (CHR-13).
 */
export function createCharacterOf(deps: CharacterOfDeps) {
  return (accountId: string, characterId: string): Promise<CharacterFacts | null> =>
    withSpan('identity.character-of', {}, async (): Promise<CharacterFacts | null> => {
      const held = await deps.characters.listByAccount(accountId);
      const character = held.find((stored) => stored.id === characterId);
      if (character === undefined) {
        return null;
      }
      return {
        characterClass: character.class,
        level: character.level,
        hardcore: character.hardcore,
        ladder: character.ladder,
        era: character.era,
        unlockedDifficulties: [...character.unlockedDifficulties],
      };
    });
}
