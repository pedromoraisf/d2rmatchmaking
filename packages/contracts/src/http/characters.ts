// Characters the agent reads on the character selection screen (CHR-06) and the site lists (CHR-11).
import { z } from 'zod';
import { Difficulty, IsoDateTime } from './common.ts';

type DifficultyValue = z.infer<typeof Difficulty>;

export const CharacterClass = z.enum([
  'amazon',
  'assassin',
  'barbarian',
  'druid',
  'necromancer',
  'paladin',
  'sorceress',
  'warlock',
]);
export type CharacterClass = z.infer<typeof CharacterClass>;

export const Era = z.enum(['classic', 'lod', 'rotw']);
export type Era = z.infer<typeof Era>;

// The mode (softcore or hardcore) and the ladder flag of a character, as the game shows them (glossary).
export const Ladder = z.enum(['sc-ladder', 'sc-nonladder', 'hc-ladder', 'hc-nonladder']);
export type Ladder = z.infer<typeof Ladder>;

// D2R's character name rule: 2 to 15 letters, with at most one `-` or `_` that is neither first nor last.
export const CharacterName = z
  .string()
  .min(2)
  .max(15)
  .regex(/^[A-Za-z]+(?:[-_][A-Za-z]+)?$/);
export type CharacterName = z.infer<typeof CharacterName>;

export const Level = z.number().int().min(1).max(99);

// The unlocked difficulties are exactly one of these lists, in this order (CHR-07, INV-02).
const ALLOWED_DIFFICULTY_LISTS: readonly (readonly DifficultyValue[])[] = [
  ['normal'],
  ['normal', 'nightmare'],
  ['normal', 'nightmare', 'hell'],
];

/** Compares values only, so any list of strings can be checked; the schema below narrows it to difficulties. */
export function isAllowedDifficultyList(list: readonly string[]): boolean {
  return ALLOWED_DIFFICULTY_LISTS.some(
    (allowed) =>
      allowed.length === list.length && allowed.every((difficulty, index) => difficulty === list[index]),
  );
}

export const UnlockedDifficulties = z
  .array(Difficulty)
  .refine(
    isAllowedDifficultyList,
    'unlockedDifficulties must be [normal], [normal, nightmare] or [normal, nightmare, hell]',
  );
export type UnlockedDifficulties = z.infer<typeof UnlockedDifficulties>;

export const CharacterReading = z.object({
  name: CharacterName,
  class: CharacterClass,
  level: Level,
  ladder: Ladder,
  era: Era,
  unlockedDifficulties: UnlockedDifficulties,
});
export type CharacterReading = z.infer<typeof CharacterReading>;

// The agent's batch: 1 to 24 cards of one screen, each name once (CHR-09, CHR-10).
export const RecordCharactersRequest = z
  .object({
    characters: z.array(CharacterReading).min(1).max(24),
  })
  .refine(
    (request) =>
      new Set(request.characters.map((character) => character.name)).size === request.characters.length,
    {
      message: 'character names must be unique within one request',
    },
  );
export type RecordCharactersRequest = z.infer<typeof RecordCharactersRequest>;

export const CharacterView = CharacterReading.extend({
  readAt: IsoDateTime,
});
export type CharacterView = z.infer<typeof CharacterView>;

export const MyCharactersResponse = z.object({
  characters: z.array(CharacterView),
});
export type MyCharactersResponse = z.infer<typeof MyCharactersResponse>;
