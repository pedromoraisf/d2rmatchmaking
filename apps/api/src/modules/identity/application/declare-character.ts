import { parseDeclaration } from '../domain/character/character.ts';
import { err, ok, withSpan, type Result } from '../../../shared-kernel/index.ts';
import type { CharacterRepository } from './character-ports.ts';

export interface DeclareCharacterDeps {
  readonly characters: CharacterRepository;
}

/**
 * Stores the ladder and era the player declares for one of their characters (CHR-15). A character of another account, or
 * none at that id, answers not-found and changes nothing (CHR-16). The span carries no name (CHR-13).
 */
export function createDeclareCharacter(deps: DeclareCharacterDeps) {
  return (input: {
    readonly accountId: string;
    readonly characterId: string;
    readonly ladder: string;
    readonly era: string;
  }): Promise<Result<void, DeclareCharacterError>> =>
    withSpan('identity.declare-character', {}, async (): Promise<Result<void, DeclareCharacterError>> => {
      const declaration = parseDeclaration({ ladder: input.ladder, era: input.era });
      if (!declaration.ok) {
        return err('invalid-declaration');
      }
      const declared = await deps.characters.declare(input.accountId, input.characterId, declaration.value);
      return declared ? ok(undefined) : err('not-found');
    });
}

/** The refusals of a declaration: a value outside the two ladder flags or the three eras, or a character not the player's. */
export type DeclareCharacterError = 'invalid-declaration' | 'not-found';
