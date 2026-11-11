// The queue use cases (design.md § Matchmaking module, application): every change to the queue runs one at a time.
import type {
  Clock,
  EventBus,
  IdGenerator,
  Outbox,
  Result,
  Scheduler,
  UnitOfWork,
  QueueTicketSnapshot,
} from '../../../shared-kernel/index.ts';
import type { ReadyCheckAnswerRefusal } from '../domain/ready-check/ready-check.ts';
import { poolSizeOf } from '../domain/matcher.ts';
import { createDropTicket, createLeaveQueue, type DropReason } from './leave-queue.ts';
import { createJoinQueue, type JoinRefusal, type PenaltyRefusal, type QueueJoinInput } from './join-queue.ts';
import { createMatchNow } from './run-matcher.ts';
import { createQueueNotifier } from './queue-notifier.ts';
import { createReadyCheckFlow } from './ready-check-flow.ts';
import { createSerialLock } from './serial-lock.ts';
import { snapshotOf } from './queue-view.ts';
import type {
  AccountLinkPort,
  AgentPresencePort,
  CharactersPort,
  JoinLimitStore,
  PenaltyStore,
  QueueMetrics,
  QueueStore,
  RatingsPort,
  ReadyCheckStore,
  RoomsPort,
  SiteConnectionsPort,
} from './ports.ts';

export interface QueueUseCaseDeps {
  readonly store: QueueStore;
  readonly joinLimits: JoinLimitStore;
  readonly characters: CharactersPort;
  readonly presence: AgentPresencePort;
  readonly links: AccountLinkPort;
  readonly sites: SiteConnectionsPort;
  readonly rooms: RoomsPort;
  readonly ratings: RatingsPort;
  /** The open ready checks (RDY-09: in memory) and the penalties of the players who did not answer (RDY-05). */
  readonly checks: ReadyCheckStore;
  readonly penalties: PenaltyStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly bus: EventBus;
  readonly metrics: QueueMetrics;
  /** The deadlines of the ready checks (the platform's timers). */
  readonly scheduler: Scheduler;
  /** Reports a ready check's deadline that failed (the composition root logs it). */
  readonly onError: (error: unknown) => void;
}

/** Builds the queue use cases over their ports. Changes (join, leave, drop, matcher run, answers, deadlines) share one lock. */
export function createQueueUseCases(deps: QueueUseCaseDeps) {
  const lock = createSerialLock();
  const notifier = createQueueNotifier({ bus: deps.bus, metrics: deps.metrics });
  const readyChecks = createReadyCheckFlow({
    store: deps.store,
    checks: deps.checks,
    penalties: deps.penalties,
    ids: deps.ids,
    clock: deps.clock,
    uow: deps.uow,
    outbox: deps.outbox,
    bus: deps.bus,
    scheduler: deps.scheduler,
    notifier,
    metrics: deps.metrics,
    exclusive: (work) => lock.run(work),
    onError: deps.onError,
  });
  const matchNow = createMatchNow({
    store: deps.store,
    clock: deps.clock,
    notifier,
    readyChecks,
  });
  const join = createJoinQueue({ ...deps, notifier, matchNow });
  const leave = createLeaveQueue({ store: deps.store, notifier });
  const drop = createDropTicket({ store: deps.store, notifier });

  return {
    joinQueue: (input: {
      readonly accountId: string;
      readonly request: QueueJoinInput;
    }): Promise<Result<QueueTicketSnapshot, JoinRefusal | PenaltyRefusal>> => lock.run(() => join(input)),

    leaveQueue: (input: { readonly accountId: string; readonly ticketId: string }) =>
      lock.run(() => leave(input)),

    dropTicket: (input: { readonly accountId: string; readonly reason: DropReason }): Promise<void> =>
      lock.run(() => drop(input)),

    /** One matcher run; the platform calls it every second (the timer in `main/`). */
    runMatcher: (): Promise<void> => lock.run(() => matchNow()),

    /** The account's open ready check as its members see it, or null (RDY-11). Read only: it takes no lock. */
    openReadyCheckOf: (input: { readonly accountId: string }) => readyChecks.openFor(input.accountId),

    /** A member's answer to a ready check: accept or decline (RDY-02, RDY-04, RDY-06). */
    answerReadyCheck: (input: {
      readonly accountId: string;
      readonly checkId: string;
      readonly answer: 'accept' | 'decline';
    }): Promise<Result<void, ReadyCheckAnswerRefusal>> => lock.run(() => readyChecks.answer(input)),

    /** The account's waiting ticket as the site shows it, or null when it is not queued (QUE-15). */
    myTicket: async (input: { readonly accountId: string }): Promise<QueueTicketSnapshot | null> => {
      const ticket = await deps.store.byAccount(input.accountId);
      if (ticket === undefined) {
        return null;
      }
      const queued = await deps.store.all();
      return snapshotOf(ticket, deps.clock.now(), poolSizeOf(ticket, queued));
    },
  };
}

export type QueueUseCases = ReturnType<typeof createQueueUseCases>;
