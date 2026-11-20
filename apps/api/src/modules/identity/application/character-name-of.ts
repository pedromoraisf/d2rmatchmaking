import { withSpan } from '../../../shared-kernel/index.ts';
import type { CharacterRepository } from './character-ports.ts';

export interface CharacterNamesOfDeps {
  readonly characters: CharacterRepository;
}

/**
 * The stored spelling of each (account, character) pair in one query, `null` for a pair the account does not hold, in the
 * order of the pairs. The Lobby Room reads it for one request to match a chat sighting (SNM-03); the caller never stores or
 * logs it, and the span carries only the count (CHR-13, SNM-04).
 */
export function createCharacterNamesOf(deps: CharacterNamesOfDeps) {
  return (
    pairs: readonly { readonly accountId: string; readonly characterId: string }[],
  ): Promise<(string | null)[]> =>
    withSpan('identity.character-names-of', { 'd2r.characters.count': pairs.length }, () =>
      deps.characters.namesOf(pairs),
    );
}
