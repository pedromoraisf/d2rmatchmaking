// The first entry rule a join fails, read on the site so "Find match" can say why it is off (QUE-15). The API applies the
// same rules in the same order and is the authority (QUE-03, QUE-04); this mirror only shows the reason before a request.
import type { CharacterView } from '@d2rmm/contracts';

export type QueueDifficulty = 'normal' | 'nightmare' | 'hell';

/** The level each difficulty needs to queue in leveling (QUE-03, from the prototype). */
export const LEVEL_FLOORS: Readonly<Record<QueueDifficulty, number>> = {
  normal: 10,
  nightmare: 40,
  hell: 70,
};

export type EntryReason =
  | 'noCharacter'
  | 'undeclared'
  | 'difficultyLocked'
  | 'activityNotAvailable'
  | 'belowFloor'
  | 'minimumBelowFloor'
  | 'belowMinimum';

/** What the player chose, before the character is checked. */
export type JoinChoice =
  | { readonly mode: 'pvp'; readonly difficulty: QueueDifficulty }
  | {
      readonly mode: 'leveling';
      readonly difficulty: QueueDifficulty;
      readonly activity: 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds';
      readonly minLevel: number;
    };

/** The reason "Find match" shows, or null when every rule passes. The order is the API's (QUE-03, QUE-04). */
export function firstEntryReason(
  character: CharacterView | undefined,
  choice: JoinChoice,
): EntryReason | null {
  if (character === undefined) {
    return 'noCharacter';
  }
  if (character.ladder === null || character.era === null) {
    return 'undeclared';
  }
  if (!character.unlockedDifficulties.includes(choice.difficulty)) {
    return 'difficultyLocked';
  }
  if (choice.mode === 'pvp') {
    return null;
  }
  if (choice.activity === 'heralds' && (choice.difficulty !== 'hell' || character.era !== 'rotw')) {
    return 'activityNotAvailable';
  }
  const floor = LEVEL_FLOORS[choice.difficulty];
  if (character.level < floor) {
    return 'belowFloor';
  }
  if (choice.minLevel < floor) {
    return 'minimumBelowFloor';
  }
  if (character.level < choice.minLevel) {
    return 'belowMinimum';
  }
  return null;
}
