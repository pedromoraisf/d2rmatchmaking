// Queue schemas (design.md § Contracts): joining and leaving the PvP and leveling queues, the ticket the site shows,
// and the refusal codes of the entry rules (QUE-01 … QUE-06, QUE-13).
import { z } from 'zod';
import { Difficulty, Id, IsoDateTime, Mode } from './common.ts';
import { Level } from './characters.ts';

export const Region = z.enum(['americas', 'europe', 'asia']);
export type Region = z.infer<typeof Region>;

export const Activity = z.enum(['baal', 'chaos', 'cows', 'tz', 'heralds']);
export type Activity = z.infer<typeof Activity>;

export const QueueRole = z.enum(['teleporter', 'bo', 'killer', 'leech']);
export type QueueRole = z.infer<typeof QueueRole>;

export const PvpFormat = z.enum(['duel', '2v2', 'arena']);
export type PvpFormat = z.infer<typeof PvpFormat>;

export const PvpRules = z.enum(['gm', 'bm']);
export type PvpRules = z.infer<typeof PvpRules>;

// The minimum level the player chooses for leveling: 1 to 99 (QUE-03 refuses one under the difficulty's floor).
export const MinimumLevel = Level;

const PvpJoin = z.object({
  mode: z.literal('pvp'),
  characterId: Id,
  difficulty: Difficulty,
  region: Region,
  format: PvpFormat,
  rules: PvpRules,
});

const LevelingJoin = z.object({
  mode: z.literal('leveling'),
  characterId: Id,
  difficulty: Difficulty,
  region: Region,
  activity: Activity,
  role: QueueRole,
  minLevel: MinimumLevel,
});

/** `POST /v1/queue/tickets`: the body is discriminated by `mode` (QUE-01, QUE-02). */
export const JoinQueueRequest = z.discriminatedUnion('mode', [PvpJoin, LevelingJoin]);
export type JoinQueueRequest = z.infer<typeof JoinQueueRequest>;

/** The options a ticket was joined with, as the site shows them. */
export const QueueOptions = JoinQueueRequest;
export type QueueOptions = z.infer<typeof QueueOptions>;

/** The rating band of a PvP ticket at the time of the view (QUE-08); null for leveling. */
export const RatingBand = z.object({
  low: z.number().int(),
  high: z.number().int(),
});
export type RatingBand = z.infer<typeof RatingBand>;

/** A ticket in the queue, as `POST`, `GET /v1/queue/tickets/me` and the `queue.updated` event show it. */
export const QueueTicketView = z.object({
  id: Id,
  status: z.literal('waiting'),
  mode: Mode,
  options: QueueOptions,
  joinedAt: IsoDateTime,
  band: RatingBand.nullable(),
  poolSize: z.number().int().min(0),
});
export type QueueTicketView = z.infer<typeof QueueTicketView>;

/** Why a ticket left the queue without the player asking for it (QUE-14), or after a match (QUE-12). */
export const QueueLeaveReason = z.enum([
  'left-by-player',
  'matched',
  'agent-offline',
  'agent-revoked',
  'site-closed',
]);
export type QueueLeaveReason = z.infer<typeof QueueLeaveReason>;

/** The stream's answer when a ticket of the account leaves the queue. */
export const QueueLeft = z.object({
  status: z.literal('left'),
  reason: QueueLeaveReason,
});
export type QueueLeft = z.infer<typeof QueueLeft>;

/** `GET /v1/queue/tickets/me`: the account's ticket, or null when it is not queued. */
export const MyQueueTicketResponse = z.object({
  ticket: QueueTicketView.nullable(),
});
export type MyQueueTicketResponse = z.infer<typeof MyQueueTicketResponse>;

/** The refusal codes of the entry rules (design.md § Contracts). */
export const QueueRefusalCode = z.enum([
  'not-your-character',
  'undeclared-character',
  'difficulty-locked',
  'below-floor',
  'below-minimum-level',
  'minimum-below-floor',
  'activity-not-available',
  'agent-offline',
  'not-linked',
  'site-not-open',
  'already-queued',
  'in-room',
  'too-many-joins',
  'queue-full',
  'ready-check-penalty',
]);
export type QueueRefusalCode = z.infer<typeof QueueRefusalCode>;

/**
 * The body of a refused `POST /v1/queue/tickets`: the reason, and no ticket. A `ready-check-penalty` refusal carries the
 * whole seconds left of the 5-minute wait (RDY-05); every other refusal has no `secondsLeft`.
 */
export const QueueRefusal = z.object({
  error: QueueRefusalCode,
  secondsLeft: z.number().int().min(1).optional(),
});
export type QueueRefusal = z.infer<typeof QueueRefusal>;
