// The queue use cases (design.md § Matchmaking module, application): every change to the queue runs one at a time.
import type {
  Clock,
  EventBus,
  IdGenerator,
  Outbox,
  Result,
  UnitOfWork,
  QueueTicketSnapshot,
} from '../../../shared-kernel/index.ts';
import { poolSizeOf } from '../domain/matcher.ts';
import { createDropTicket, createLeaveQueue, type DropReason } from './leave-queue.ts';
import { createJoinQueue, type JoinRefusal, type QueueJoinInput } from './join-queue.ts';
import { createMatchNow } from './run-matcher.ts';
import { createQueueNotifier } from './queue-notifier.ts';
import { createSerialLock } from './serial-lock.ts';
import { snapshotOf } from './queue-view.ts';
import type {
  AccountLinkPort,
  AgentPresencePort,
  CharactersPort,
  QueueMetrics,
  QueueStore,
  RatingsPort,
  RoomsPort,
  SiteConnectionsPort,
} from './ports.ts';

export interface QueueUseCaseDeps {
  readonly store: QueueStore;
  readonly characters: CharactersPort;
  readonly presence: AgentPresencePort;
  readonly links: AccountLinkPort;
  readonly sites: SiteConnectionsPort;
  readonly rooms: RoomsPort;
  readonly ratings: RatingsPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly bus: EventBus;
  readonly metrics: QueueMetrics;
}

/** Builds the queue use cases over their ports. Changes (join, leave, drop, matcher run) share one lock. */
export function createQueueUseCases(deps: QueueUseCaseDeps) {
  const lock = createSerialLock();
  const notifier = createQueueNotifier({ bus: deps.bus, metrics: deps.metrics });
  const matchNow = createMatchNow({
    store: deps.store,
    ids: deps.ids,
    clock: deps.clock,
    uow: deps.uow,
    outbox: deps.outbox,
    notifier,
  });
  const join = createJoinQueue({ ...deps, notifier, matchNow });
  const leave = createLeaveQueue({ store: deps.store, notifier });
  const drop = createDropTicket({ store: deps.store, notifier });

  return {
    joinQueue: (input: {
      readonly accountId: string;
      readonly request: QueueJoinInput;
    }): Promise<Result<QueueTicketSnapshot, JoinRefusal>> => lock.run(() => join(input)),

    leaveQueue: (input: { readonly accountId: string; readonly ticketId: string }) =>
      lock.run(() => leave(input)),

    dropTicket: (input: { readonly accountId: string; readonly reason: DropReason }): Promise<void> =>
      lock.run(() => drop(input)),

    /** One matcher run; the platform calls it every second (the timer in `main/`). */
    runMatcher: (): Promise<void> => lock.run(() => matchNow()),

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
