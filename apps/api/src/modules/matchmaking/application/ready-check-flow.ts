// The ready check's application (RDY-01 … RDY-06, RDY-10): opening the check for a formed group, the members' answers, the
// deadline, and how the check ends. Every change runs under the queue's lock (`queue-use-cases.ts`), the deadline too.
import { D2R_DIFFICULTY, D2R_QUEUE_MODE } from '@d2rmm/telemetry';
import type { FormedGroup } from '../domain/matcher.ts';
import {
  accept,
  decline,
  expire,
  isOpenAt,
  openReadyCheck,
  rejoinQueue,
  unansweredOf,
  type ReadyCheck,
  type ReadyCheckAnswerRefusal,
  type ReadyCheckOutcome,
} from '../domain/ready-check/ready-check.ts';
import { penaltyUntil } from '../domain/ready-check/penalty.ts';
import type { QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';
import {
  err,
  ok,
  withRecordingSpan,
  type Cancel,
  type Clock,
  type EventBus,
  type IdGenerator,
  type Outbox,
  type ReadyCheckChangedPayload,
  type Result,
  type Scheduler,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import { matchFormedEvent } from './match-formed.ts';
import type { QueueNotifier } from './queue-notifier.ts';
import type { PenaltyStore, QueueMetrics, QueueStore, ReadyCheckStore } from './ports.ts';
import type { ReadyCheckOpener } from './run-matcher.ts';

/** How long an ended check stays answerable as ended (RDY-06) before the store drops it. */
export const ENDED_CHECK_KEEP_MS = 10 * 60 * 1000;

export interface ReadyCheckFlowDeps {
  readonly store: QueueStore;
  readonly checks: ReadyCheckStore;
  readonly penalties: PenaltyStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly bus: EventBus;
  readonly scheduler: Scheduler;
  readonly notifier: QueueNotifier;
  readonly metrics: QueueMetrics;
  /** Runs one piece of queue work under the queue's lock; the deadline uses it too. */
  readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** Reports a deadline that failed; the check stays as it was and the next start of the process settles nothing. */
  readonly onError: (error: unknown) => void;
}

export interface ReadyCheckFlow extends ReadyCheckOpener {
  answer(input: {
    readonly accountId: string;
    readonly checkId: string;
    readonly answer: 'accept' | 'decline';
  }): Promise<Result<void, ReadyCheckAnswerRefusal>>;
  /** The account's open check as its members see it, or null when the account is in no open check (RDY-11). */
  openFor(accountId: string): Promise<ReadyCheckChangedPayload | null>;
}

/** The state of an open check as the members' streams carry it: the marks, the accepted and the deadline (RDY-01, RDY-02). */
export function changedPayloadOf(check: ReadyCheck): ReadyCheckChangedPayload {
  return {
    readyCheckId: check.id,
    mode: check.group.mode,
    difficulty: check.group.difficulty,
    deadline: check.deadline.toISOString(),
    members: check.group.members.map((member, index) => ({
      accountId: member.accountId,
      position: index + 1,
      characterClass: member.characterClass,
      level: member.level,
      accepted: check.accepted.includes(member.accountId),
    })),
  };
}

export function createReadyCheckFlow(deps: ReadyCheckFlowDeps): ReadyCheckFlow {
  /** The pending deadline of each open check, cancelled when the check ends before it. */
  const deadlines = new Map<string, Cancel>();

  /** The tickets of the accepted members go back to the queue with their join instants (RDY-04, RDY-05). */
  async function returnToQueue(tickets: readonly QueueTicket[], now: Date): Promise<void> {
    if (tickets.length === 0) {
      return;
    }
    for (const ticket of tickets) {
      await deps.store.add(ticket);
    }
    const waiting = await deps.store.all();
    await deps.notifier.refresh(waiting, now);
    deps.notifier.sizes(waiting);
  }

  /** Ends the check with its outcome: the match is written (accepted), or the penalties and the re-entry are (otherwise). */
  async function settle(check: ReadyCheck, outcome: ReadyCheckOutcome, now: Date): Promise<void> {
    await deps.checks.put(check);
    deadlines.get(check.id)?.();
    deadlines.delete(check.id);
    if (outcome === 'accepted') {
      const matchId = deps.ids.next();
      await deps.uow.run(async (tx) => {
        await deps.outbox.append(tx, [matchFormedEvent(check.group, matchId)]);
      });
    } else {
      if (outcome === 'timed-out') {
        const unanswered = unansweredOf(check).map((member) => member.accountId);
        await deps.penalties.record(unanswered, penaltyUntil(now), 'ready-check-timeout');
      }
      await returnToQueue(rejoinQueue([], check), now);
    }
    await deps.bus.publish({
      kind: 'transient',
      event: {
        type: 'ReadyCheckResolved',
        payload: {
          readyCheckId: check.id,
          outcome,
          accountIds: check.group.members.map((member) => member.accountId),
        },
      },
    });
    deps.metrics.readyCheckResolved(outcome);
  }

  /** The deadline: a check still open at its deadline ends as timed out (RDY-05). A check settled earlier is left alone. */
  async function expireCheck(checkId: string): Promise<void> {
    const check = await deps.checks.find(checkId);
    if (check === undefined) {
      return;
    }
    const now = deps.clock.now();
    const ended = expire(check, now);
    const outcome = ended.outcome;
    if (ended === check || outcome === null) {
      return;
    }
    await withRecordingSpan('matchmaking.ready-check.resolve', {}, () => settle(ended, outcome, now));
  }

  return {
    async open(group: FormedGroup, now: Date): Promise<void> {
      await withRecordingSpan(
        'matchmaking.ready-check.open',
        { [D2R_QUEUE_MODE]: group.mode, [D2R_DIFFICULTY]: group.difficulty },
        async () => {
          const check = openReadyCheck(deps.ids.next(), group, now);
          await deps.checks.put(check);
          await deps.checks.pruneEndedBefore(new Date(now.getTime() - ENDED_CHECK_KEEP_MS));
          await deps.bus.publish({
            kind: 'transient',
            event: { type: 'ReadyCheckStarted', payload: changedPayloadOf(check) },
          });
          const cancel = deps.scheduler.at(check.deadline, () => {
            deps.exclusive(() => expireCheck(check.id)).catch(deps.onError);
          });
          deadlines.set(check.id, cancel);
        },
      );
    },

    async openFor(accountId: string): Promise<ReadyCheckChangedPayload | null> {
      const check = await deps.checks.openOf(accountId);
      if (check === undefined || !isOpenAt(check, deps.clock.now())) {
        return null;
      }
      return changedPayloadOf(check);
    },

    answer(input) {
      return withRecordingSpan(
        'matchmaking.ready-check.answer',
        {},
        async (): Promise<Result<void, ReadyCheckAnswerRefusal>> => {
          const check = await deps.checks.find(input.checkId);
          if (check === undefined) {
            return err('not-found');
          }
          const now = deps.clock.now();
          const answered =
            input.answer === 'accept'
              ? accept(check, input.accountId, now)
              : decline(check, input.accountId, now);
          if (!answered.ok) {
            return err(answered.error);
          }
          const next = answered.value;
          if (next.outcome === null) {
            await deps.checks.put(next);
            await deps.bus.publish({
              kind: 'transient',
              event: { type: 'ReadyCheckUpdated', payload: changedPayloadOf(next) },
            });
            return ok(undefined);
          }
          await settle(next, next.outcome, now);
          return ok(undefined);
        },
      );
    },
  };
}
