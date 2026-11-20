import { withSpan } from '../../../shared-kernel/index.ts';
import type { CharacterRepository } from './character-ports.ts';

export interface CharacterNameOfDeps {
  readonly characters: CharacterRepository;
}

/**
 * The stored spelling of one of the account's characters, or null when the account holds no such character. The Lobby
 * Room reads it for one request to match a chat sighting (SNM-03); the caller never stores or logs it, and the span carries
 * no name (CHR-13, SNM-04).
 */
export function createCharacterNameOf(deps: CharacterNameOfDeps) {
  return (accountId: string, characterId: string): Promise<string | null> =>
    withSpan('identity.character-name-of', {}, async (): Promise<string | null> => {
      const held = await deps.characters.listByAccount(accountId);
      return held.find((stored) => stored.id === characterId)?.name ?? null;
    });
}
