import { withSpan } from '../../../shared-kernel/index.ts';
import type { CharacterRepository, StoredCharacter } from './character-ports.ts';

export interface ListMyCharactersDeps {
  readonly characters: CharacterRepository;
}

/** The signed-in player's characters, as the last readings left them (CHR-11). */
export function createListMyCharacters(deps: ListMyCharactersDeps) {
  return (input: { readonly accountId: string }): Promise<readonly StoredCharacter[]> =>
    withSpan('identity.list-characters', {}, () => deps.characters.listByAccount(input.accountId));
}
