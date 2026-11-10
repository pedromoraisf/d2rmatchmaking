// Maps contract values to translation keys, so the site never shows a raw enum (AWS-14, AWS-21, AWS-23).
import type {
  AgentPresenceChangedEvent,
  CharacterClass,
  CharacterReading,
  Era,
  Ladder,
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

// A ladder value is a mode and a ladder flag together (glossary); the list shows the two words separately.
const LADDER_WORDS: Record<Ladder, { mode: 'softcore' | 'hardcore'; ladder: 'ladder' | 'nonLadder' }> = {
  'sc-ladder': { mode: 'softcore', ladder: 'ladder' },
  'sc-nonladder': { mode: 'softcore', ladder: 'nonLadder' },
  'hc-ladder': { mode: 'hardcore', ladder: 'ladder' },
  'hc-nonladder': { mode: 'hardcore', ladder: 'nonLadder' },
};
export const modeKey = (ladder: CharacterReading['ladder']): string =>
  `characters.modes.${LADDER_WORDS[ladder].mode}`;
export const ladderKey = (ladder: CharacterReading['ladder']): string =>
  `characters.ladders.${LADDER_WORDS[ladder].ladder}`;
