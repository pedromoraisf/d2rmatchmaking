// Maps contract values to translation keys, so the site never shows a raw enum (AWS-14, AWS-21, AWS-23).
import type {
  AgentPresenceChangedEvent,
  CharacterClass,
  CharacterReading,
  DeclaredLadder,
  Era,
  RoomView,
} from '@d2rmm/contracts';

type Stage = RoomView['stage'];
type Screen = AgentPresenceChangedEvent['data']['screen'];
type Difficulty = CharacterReading['unlockedDifficulties'][number];

export const stageKey = (stage: Stage): string => `room.stages.${stage}`;
export const screenKey = (screen: Screen): string => `presence.screen.${screen}`;
export const onlineKey = (online: boolean): string => (online ? 'presence.online' : 'presence.offline');
export const gameKey = (gameRunning: boolean): string =>
  gameRunning ? 'presence.gameOpen' : 'presence.gameClosed';

export const classKey = (characterClass: CharacterClass): string => `characters.classes.${characterClass}`;
export const eraKey = (era: Era): string => `characters.eras.${era}`;
export const difficultyKey = (difficulty: Difficulty): string => `characters.difficulties.${difficulty}`;

// The mode comes from the reading (softcore or hardcore); the ladder flag is the one the player declared (CHR-15).
export const modeKey = (hardcore: boolean): string =>
  `characters.modes.${hardcore ? 'hardcore' : 'softcore'}`;
const LADDER_WORDS: Record<DeclaredLadder, 'ladder' | 'nonLadder'> = {
  ladder: 'ladder',
  'non-ladder': 'nonLadder',
};
export const ladderKey = (ladder: DeclaredLadder): string => `characters.ladders.${LADDER_WORDS[ladder]}`;

// The two-letter mark on a character's card (SHL-04). Decorative: the class name is the text the player reads.
const CLASS_MARKS: Record<CharacterClass, string> = {
  amazon: 'AM',
  assassin: 'AS',
  barbarian: 'BA',
  druid: 'DR',
  necromancer: 'NE',
  paladin: 'PA',
  sorceress: 'SO',
  warlock: 'WL',
};
export const classMark = (characterClass: CharacterClass): string => CLASS_MARKS[characterClass];

// The colour of a difficulty's tag: Normal, Nightmare and Hell (SHL-04).
export type DifficultyTone = 'd-n' | 'd-nm' | 'd-h';
const DIFFICULTY_TONES: Record<Difficulty, DifficultyTone> = {
  normal: 'd-n',
  nightmare: 'd-nm',
  hell: 'd-h',
};
export const difficultyTone = (difficulty: Difficulty): DifficultyTone => DIFFICULTY_TONES[difficulty];
