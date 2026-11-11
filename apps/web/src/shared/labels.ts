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
