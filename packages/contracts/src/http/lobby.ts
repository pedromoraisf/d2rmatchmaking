// Lobby Room schemas: the observation an agent posts, the assignment it reads, and the room a site member sees.
import { z } from 'zod';
import { Difficulty, GameName, Id, IsoDateTime, Member, Mode, RoomStage } from './common.ts';

// The six observation types of the glossary. Anything else is caught to UNKNOWN and the server discards it (AWS-25).
export const OBSERVATION_TYPES = [
  'GAME_NAME_SEEN',
  'PLAYER_JOINED_SEEN',
  'PLAYER_LEFT_SEEN',
  'SCREEN_CHANGED',
  'ROUND_REPORTED',
  'PLAYER_SLAIN_SEEN',
] as const;

export const ObservationType = z.union([z.enum(OBSERVATION_TYPES), z.literal('UNKNOWN')]).catch('UNKNOWN');

export const Observation = z.object({
  idempotencyKey: z.string().min(1).max(64),
  type: ObservationType,
  run: z.number().int().min(1),
  value: z.string().max(64),
  confidence: z.number().min(0).max(1),
  signals: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
  capturedAt: IsoDateTime,
});
export type Observation = z.infer<typeof Observation>;

export const Assignment = z.object({
  roomId: Id,
  run: z.number().int().min(1),
  expectedGameName: GameName,
  members: z.array(Member).min(1),
});
export type Assignment = z.infer<typeof Assignment>;

export const RoomView = z.object({
  roomId: Id,
  mode: Mode,
  activity: z.string().min(1).max(32),
  difficulty: Difficulty,
  stage: RoomStage,
  run: z.number().int().min(1),
  expectedGameName: GameName,
  password: z.literal(''),
  members: z.array(Member).min(1),
});
export type RoomView = z.infer<typeof RoomView>;
