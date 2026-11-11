// Ready checks (RDY-01 … RDY-06): the check a formed group confirms, the answers the members send, and the refusals of an
// answer that comes too late, twice or from a player who is not in the check. Members are shown by position and class
// mark, never by name (spec decisions).
import { z } from 'zod';
import { Difficulty, Id, IsoDateTime, Mode } from './common.ts';
import { CharacterClass, Level } from './characters.ts';

/** How a ready check ended (RDY-03, RDY-04, RDY-05). */
export const ReadyCheckOutcome = z.enum(['accepted', 'declined', 'timed-out']);
export type ReadyCheckOutcome = z.infer<typeof ReadyCheckOutcome>;

/** One member of the check, by position: the class mark and the level the site and the agent show (RDY-01, RDY-02). */
export const ReadyCheckMember = z.object({
  position: z.number().int().min(1).max(8),
  class: CharacterClass,
  level: Level,
  accepted: z.boolean(),
  you: z.boolean(),
});
export type ReadyCheckMember = z.infer<typeof ReadyCheckMember>;

/** An open ready check as a member sees it: its deadline (60 seconds after it opened, RDY-01) and its members. */
export const ReadyCheckView = z.object({
  id: Id,
  mode: Mode,
  difficulty: Difficulty,
  deadline: IsoDateTime,
  members: z.array(ReadyCheckMember).min(2).max(8),
});
export type ReadyCheckView = z.infer<typeof ReadyCheckView>;

/** `ready_check.resolved`: the check ended with this outcome (RDY-03 … RDY-05). */
export const ReadyCheckResolved = z.object({
  id: Id,
  outcome: ReadyCheckOutcome,
});
export type ReadyCheckResolved = z.infer<typeof ReadyCheckResolved>;

/**
 * The refusals of `POST /v1/ready-checks/:id/accept` and `/decline` (RDY-06): 409 for a check that ended or an answer
 * already given, 404 for a check the player is not in. A refused answer changes nothing.
 */
export const ReadyCheckAnswerRefusalCode = z.enum(['ready-check-ended', 'already-answered', 'not-found']);
export type ReadyCheckAnswerRefusalCode = z.infer<typeof ReadyCheckAnswerRefusalCode>;

export const ReadyCheckAnswerRefusal = z.object({
  error: ReadyCheckAnswerRefusalCode,
});
export type ReadyCheckAnswerRefusal = z.infer<typeof ReadyCheckAnswerRefusal>;
