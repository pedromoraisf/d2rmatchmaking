import { err, ok, type Result } from '../../../../shared-kernel/result.ts';

/** The classes of D2R (glossary). The agent reads the class from the card; the site shows it in words. */
export const CHARACTER_CLASSES = [
  'amazon',
  'assassin',
  'barbarian',
  'druid',
  'necromancer',
  'paladin',
  'sorceress',
  'warlock',
] as const;
export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

/** Expansion eras (glossary): classic, Lord of Destruction, Reign of the Warlock. The player declares the era (CHR-15). */
export const ERAS = ['classic', 'lod', 'rotw'] as const;
export type Era = (typeof ERAS)[number];

/**
 * The ladder flag the player declares on the site (CHR-15). The selection screen does not show it; the mode (softcore or
 * hardcore) comes from the reading and the queues combine the two into the glossary's ladder value.
 */
export const DECLARED_LADDERS = ['ladder', 'non-ladder'] as const;
export type DeclaredLadder = (typeof DECLARED_LADDERS)[number];

export type Difficulty = 'normal' | 'nightmare' | 'hell';

/** One batch of the agent holds at most this many cards of one screen (CHR-10). */
export const MAX_CHARACTERS_PER_BATCH = 24;
/** An account holds at most this many stored characters; a batch that would pass it stores nothing (security finding 2). */
export const MAX_CHARACTERS_PER_ACCOUNT = 60;
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 99;
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 15;
/** D2R's name rule: letters, with at most one `-` or `_` that is neither first nor last (CHR-10). */
const NAME_PATTERN = /^[A-Za-z]+(?:[-_][A-Za-z]+)?$/;

/** The unlocked difficulties are exactly one of these lists (CHR-07, INV-02). */
const ALLOWED_DIFFICULTY_LISTS: readonly (readonly Difficulty[])[] = [
  ['normal'],
  ['normal', 'nightmare'],
  ['normal', 'nightmare', 'hell'],
];

/** A character as the agent sent it, before any rule is applied. */
export interface CharacterInput {
  readonly name: string;
  readonly class: string;
  readonly level: number;
  readonly hardcore: boolean;
  readonly unlockedDifficulties: readonly string[];
}

/** A character that passed every rule of CHR-10. Ladder and era are not part of a reading (CHR-15). */
export interface Character {
  readonly name: string;
  readonly class: CharacterClass;
  readonly level: number;
  readonly hardcore: boolean;
  readonly unlockedDifficulties: readonly Difficulty[];
}

/** The player's declaration of ladder and era for one character (CHR-15). */
export interface Declaration {
  readonly ladder: DeclaredLadder;
  readonly era: Era;
}

/** True when the value is one of `values`. Narrows the type without a cast. */
function oneOf<T extends string>(values: readonly T[], raw: string): T | undefined {
  return values.find((value) => value === raw);
}

/** True for a name D2R accepts: 2 to 15 characters, letters with at most one inner `-` or `_`. */
export function isCharacterName(raw: string): boolean {
  return raw.length >= NAME_MIN_LENGTH && raw.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(raw);
}

/** True for a level from 1 to 99. */
export function isCharacterLevel(level: number): boolean {
  return Number.isInteger(level) && level >= LEVEL_MIN && level <= LEVEL_MAX;
}

/** True when the list is exactly `[normal]`, `[normal, nightmare]` or `[normal, nightmare, hell]`, in that order. */
export function isAllowedDifficultyList(list: readonly string[]): list is readonly Difficulty[] {
  return ALLOWED_DIFFICULTY_LISTS.some(
    (allowed) =>
      allowed.length === list.length && allowed.every((difficulty, index) => difficulty === list[index]),
  );
}

/** Validates one card. Every field must pass; a card with any failing field is refused as a whole. */
export function parseCharacter(input: CharacterInput): Result<Character, 'invalid-character'> {
  const characterClass = oneOf(CHARACTER_CLASSES, input.class);
  if (
    !isCharacterName(input.name) ||
    characterClass === undefined ||
    !isCharacterLevel(input.level) ||
    typeof input.hardcore !== 'boolean' ||
    !isAllowedDifficultyList(input.unlockedDifficulties)
  ) {
    return err('invalid-character');
  }
  return ok({
    name: input.name,
    class: characterClass,
    level: input.level,
    hardcore: input.hardcore,
    unlockedDifficulties: [...input.unlockedDifficulties],
  });
}

/** Validates the player's declaration: one of the two ladder flags and one of the three eras (CHR-15). */
export function parseDeclaration(input: {
  readonly ladder: string;
  readonly era: string;
}): Result<Declaration, 'invalid-declaration'> {
  const ladder = oneOf(DECLARED_LADDERS, input.ladder);
  const era = oneOf(ERAS, input.era);
  if (ladder === undefined || era === undefined) {
    return err('invalid-declaration');
  }
  return ok({ ladder, era });
}

/**
 * Validates a whole batch: 1 to 24 cards, each valid, with unique names (CHR-09, CHR-10). Any refusal refuses the
 * batch, so the API stores none of it.
 */
export function parseCharacterBatch(
  inputs: readonly CharacterInput[],
): Result<readonly Character[], 'invalid-batch'> {
  if (inputs.length < 1 || inputs.length > MAX_CHARACTERS_PER_BATCH) {
    return err('invalid-batch');
  }
  const characters: Character[] = [];
  for (const input of inputs) {
    const parsed = parseCharacter(input);
    if (!parsed.ok) {
      return err('invalid-batch');
    }
    characters.push(parsed.value);
  }
  if (new Set(characters.map((character) => characterKey(character.name))).size !== characters.length) {
    return err('invalid-batch');
  }
  return ok(characters);
}

/**
 * The key a name is stored and matched by. D2R compares names without case (CHR-10), so `Abc` and `abc` are one
 * character; the stored row keeps the newest spelling.
 */
export function characterKey(name: string): string {
  return name.toLowerCase();
}

/**
 * True when storing the batch keeps the account within MAX_CHARACTERS_PER_ACCOUNT. A name the account already holds is
 * replaced in place, so only the new names count against the limit (security finding 2).
 */
export function fitsAccountLimit(storedNames: readonly string[], batch: readonly Character[]): boolean {
  const held = new Set(storedNames.map(characterKey));
  const newNames = batch.filter((character) => !held.has(characterKey(character.name))).length;
  return storedNames.length + newNames <= MAX_CHARACTERS_PER_ACCOUNT;
}
