// The entry rules of a queue join (QUE-03, QUE-04). Pure: the character's facts and the request come in as values.
import { err, ok, type Result } from '../../../shared-kernel/result.ts';
import type { Activity, QueueDifficulty, QueueEra, QueueLadder } from './queue-ticket/queue-ticket.ts';

/** The level a character needs to queue for each difficulty in leveling (QUE-03, prototype). */
export const LEVEL_FLOORS: Readonly<Record<QueueDifficulty, number>> = {
  normal: 10,
  nightmare: 40,
  hell: 70,
};

/** The refusals of the entry rules; the adapters map them to the contract's `QueueRefusalCode` (QUE-03, QUE-04). */
export type EntryRefusal =
  | 'undeclared-character'
  | 'difficulty-locked'
  | 'below-floor'
  | 'minimum-below-floor'
  | 'below-minimum-level'
  | 'activity-not-available';

/** The character facts the rules read. `ladder` and `era` are null until the player declares them (CHR-15). */
export interface EntryCharacter {
  readonly level: number;
  readonly hardcore: boolean;
  readonly ladder: 'ladder' | 'non-ladder' | null;
  readonly era: QueueEra | null;
  readonly unlockedDifficulties: readonly QueueDifficulty[];
}

export type EntryRequest =
  | { readonly mode: 'pvp'; readonly difficulty: QueueDifficulty }
  | {
      readonly mode: 'leveling';
      readonly difficulty: QueueDifficulty;
      readonly activity: Activity;
      readonly minLevel: number;
    };

export interface EntryDeclaration {
  readonly ladder: QueueLadder;
  readonly era: QueueEra;
}

/** The glossary's combined ladder value: the mode from the reading and the flag the player declared (CHR-15). */
export function combinedLadder(hardcore: boolean, ladder: 'ladder' | 'non-ladder'): QueueLadder {
  const mode = hardcore ? 'hc' : 'sc';
  return ladder === 'ladder' ? `${mode}-ladder` : `${mode}-nonladder`;
}

/**
 * Checks one join. The order is fixed so each refusal has one reason: the declaration, the unlocked difficulty, the
 * activity, the difficulty's floor, the minimum's floor, then the chosen minimum (QUE-03, QUE-04). PvP has no level rule.
 */
export function checkEntry(
  character: EntryCharacter,
  request: EntryRequest,
): Result<EntryDeclaration, EntryRefusal> {
  if (character.ladder === null || character.era === null) {
    return err('undeclared-character');
  }
  if (!character.unlockedDifficulties.includes(request.difficulty)) {
    return err('difficulty-locked');
  }
  if (request.mode === 'pvp') {
    return ok({ ladder: combinedLadder(character.hardcore, character.ladder), era: character.era });
  }
  if (request.activity === 'heralds' && (request.difficulty !== 'hell' || character.era !== 'rotw')) {
    return err('activity-not-available');
  }
  const floor = LEVEL_FLOORS[request.difficulty];
  if (character.level < floor) {
    return err('below-floor');
  }
  if (request.minLevel < floor) {
    return err('minimum-below-floor');
  }
  if (character.level < request.minLevel) {
    return err('below-minimum-level');
  }
  return ok({ ladder: combinedLadder(character.hardcore, character.ladder), era: character.era });
}
