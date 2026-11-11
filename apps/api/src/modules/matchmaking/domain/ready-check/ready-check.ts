// The ready check (RDY-01 … RDY-06): every member of a formed group confirms within 60 seconds. Pure: the caller passes
// `now`, and every answer returns a new value, so a refused answer changes nothing.
import { err, ok, type Result } from '../../../../shared-kernel/result.ts';
import { compareJoinOrder, type QueueTicket } from '../queue-ticket/queue-ticket.ts';
import type { FormedGroup } from '../matcher.ts';

/** The time members have to answer, from the moment the check opens (RDY-01). */
export const READY_CHECK_MS = 60 * 1000;

export type ReadyCheckOutcome = 'accepted' | 'declined' | 'timed-out';

/** Why an answer is refused (RDY-06): 404 for a player not in the check, 409 for an ended check or a repeated answer. */
export type ReadyCheckAnswerRefusal = 'not-found' | 'ready-check-ended' | 'already-answered';

export interface ReadyCheck {
  readonly id: string;
  /** The group the check confirms: its members in join order and its host (QUE-12). */
  readonly group: FormedGroup;
  readonly openedAt: Date;
  readonly deadline: Date;
  /** The accounts that accepted, in the order they accepted. */
  readonly accepted: readonly string[];
  /** How the check ended; null while it is open. */
  readonly outcome: ReadyCheckOutcome | null;
}

/** Opens the check for a formed group: the deadline is 60 seconds after `now` (RDY-01). */
export function openReadyCheck(id: string, group: FormedGroup, now: Date): ReadyCheck {
  return {
    id,
    group,
    openedAt: now,
    deadline: new Date(now.getTime() + READY_CHECK_MS),
    accepted: [],
    outcome: null,
  };
}

/** The check is open while it has no outcome and `now` is before its deadline (RDY-05: at the deadline it has ended). */
export function isOpenAt(check: ReadyCheck, now: Date): boolean {
  return check.outcome === null && now.getTime() < check.deadline.getTime();
}

/** The account holds a ticket in this check. */
export function isMember(check: ReadyCheck, accountId: string): boolean {
  return check.group.members.some((member) => member.accountId === accountId);
}

/** The members in join order, as the tickets the group holds. */
export function membersOf(check: ReadyCheck): readonly QueueTicket[] {
  return check.group.members;
}

/**
 * Records the member's acceptance (RDY-02). When every member has accepted the check is accepted at once (RDY-03).
 * Answers with the check as it is after the answer, or the refusal (RDY-06).
 */
export function accept(
  check: ReadyCheck,
  accountId: string,
  now: Date,
): Result<ReadyCheck, ReadyCheckAnswerRefusal> {
  const refusal = answerRefusal(check, accountId, now);
  if (refusal !== null) {
    return err(refusal);
  }
  const accepted = [...check.accepted, accountId];
  const everyoneAccepted = check.group.members.every((member) => accepted.includes(member.accountId));
  return ok({ ...check, accepted, outcome: everyoneAccepted ? 'accepted' : null });
}

/** A member declines: the check ends at once as declined (RDY-04). The decliner has no penalty. */
export function decline(
  check: ReadyCheck,
  accountId: string,
  now: Date,
): Result<ReadyCheck, ReadyCheckAnswerRefusal> {
  const refusal = answerRefusal(check, accountId, now);
  if (refusal !== null) {
    return err(refusal);
  }
  return ok({ ...check, outcome: 'declined' });
}

/**
 * Ends the check as timed out when its deadline has passed and it is still open (RDY-05). A check not yet due is
 * returned unchanged, so the timer can call this at any time.
 */
export function expire(check: ReadyCheck, now: Date): ReadyCheck {
  if (check.outcome !== null || now.getTime() < check.deadline.getTime()) {
    return check;
  }
  return { ...check, outcome: 'timed-out' };
}

/** The members who did not accept: on a timeout each one keeps the 5-minute wait (RDY-05). */
export function unansweredOf(check: ReadyCheck): readonly QueueTicket[] {
  return check.group.members.filter((member) => !check.accepted.includes(member.accountId));
}

/**
 * The tickets that go back into the queue when a check ends without a match (RDY-04, RDY-05): the members who accepted,
 * with the join instants they had, so each stands ahead of every ticket that joined after it (INV-05). Returned in join
 * order, merged with the tickets already waiting.
 */
export function rejoinQueue(waiting: readonly QueueTicket[], check: ReadyCheck): readonly QueueTicket[] {
  const returning = check.group.members.filter((member) => check.accepted.includes(member.accountId));
  return [...waiting, ...returning].sort(compareJoinOrder);
}

function answerRefusal(check: ReadyCheck, accountId: string, now: Date): ReadyCheckAnswerRefusal | null {
  if (!isMember(check, accountId)) {
    return 'not-found';
  }
  if (!isOpenAt(check, now)) {
    return 'ready-check-ended';
  }
  if (check.accepted.includes(accountId)) {
    return 'already-answered';
  }
  return null;
}
