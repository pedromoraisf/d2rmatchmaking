// Lobby Room schemas: the observation an agent posts, the assignment it reads, and the room a site member sees.
import { z } from 'zod';
import { CharacterClass, Level } from './characters.ts';
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

// A member as the site's room panel shows it: the room's member with the character's class and level (null when the
// character is unknown). The names stay out (LBR-13).
export const RoomMemberView = Member.extend({
  class: CharacterClass.nullable(),
  level: Level.nullable(),
});
export type RoomMemberView = z.infer<typeof RoomMemberView>;

// One run of the room's history: its number and game name (LBR-12).
export const RoomRun = z.object({ run: z.number().int().min(1), gameName: GameName });
export type RoomRun = z.infer<typeof RoomRun>;

export const RoomView = z.object({
  roomId: Id,
  mode: Mode,
  activity: z.string().min(1).max(32),
  difficulty: Difficulty,
  stage: RoomStage,
  run: z.number().int().min(1),
  expectedGameName: GameName,
  password: z.literal(''),
  // The reader's own account: the panel marks "you" and shows Next run / Close for the host.
  you: Id,
  members: z.array(RoomMemberView).min(1),
  // The run history, oldest first, the current run last (LBR-12).
  runs: z.array(RoomRun).min(1),
  // When the room expires if the host has not created the game; null in any other stage (LBR-05).
  expiresAt: IsoDateTime.nullable(),
  // The server's clock when the view was read: the panel counts down from it, not from its own clock.
  serverNow: IsoDateTime,
});
export type RoomView = z.infer<typeof RoomView>;

// POST /v1/lobby-rooms/:id/runs, /leave and /close take an empty JSON body (the same-origin guard requires one).
export const RoomActionRequest = z.object({});
export type RoomActionRequest = z.infer<typeof RoomActionRequest>;
