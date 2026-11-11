// In-memory doubles of the queue's ports (ADR 006: the queue lives in memory). Tests set the facts they need explicitly.
import type { EntryCharacter } from '../../domain/entry-rules.ts';
import type { QueueTicket } from '../../domain/queue-ticket/queue-ticket.ts';
import type { ReadyCheck } from '../../domain/ready-check/ready-check.ts';
import type {
  BusEvent,
  CharacterClassName,
  EventBus,
  QueueLeaveReason,
  ReadyCheckChangedPayload,
  ReadyCheckResolvedPayload,
} from '../../../../shared-kernel/index.ts';
import type { SlidingWindowLimit } from '../../../../shared-kernel/sliding-window.ts';
import type {
  AccountLinkPort,
  AgentPresencePort,
  CharactersPort,
  JoinLimitStore,
  PenaltyStore,
  QueueAttributes,
  QueueCharacter,
  QueueMetrics,
  QueueStore,
  RatingsPort,
  ReadyCheckStore,
  RoomsPort,
  SiteConnectionsPort,
} from '../ports.ts';

/** The attempts per account, kept in full: the tests of the joins limit read the window they set (QUE-18). */
export class InMemoryJoinLimits implements JoinLimitStore {
  readonly #attempts = new Map<string, Date[]>();
  readonly #window: SlidingWindowLimit;

  constructor(window: SlidingWindowLimit) {
    this.#window = window;
  }

  async timestamps(accountId: string): Promise<readonly Date[]> {
    return [...(this.#attempts.get(accountId) ?? [])];
  }

  async record(accountId: string, at: Date): Promise<void> {
    const kept = (this.#attempts.get(accountId) ?? []).filter(
      (time) => at.getTime() - time.getTime() < this.#window.windowMs,
    );
    this.#attempts.set(accountId, [...kept, new Date(at.getTime())]);
  }
}

/** The queue as a list in the order tickets joined. */
export class InMemoryQueueStore implements QueueStore {
  readonly #tickets: QueueTicket[] = [];

  async add(ticket: QueueTicket): Promise<void> {
    this.#tickets.push(ticket);
  }

  async remove(ticketIds: readonly string[]): Promise<void> {
    const gone = new Set(ticketIds);
    for (let index = this.#tickets.length - 1; index >= 0; index -= 1) {
      if (gone.has(this.#tickets[index]?.id ?? '')) {
        this.#tickets.splice(index, 1);
      }
    }
  }

  async find(ticketId: string): Promise<QueueTicket | undefined> {
    return this.#tickets.find((ticket) => ticket.id === ticketId);
  }

  async byAccount(accountId: string): Promise<QueueTicket | undefined> {
    return this.#tickets.find((ticket) => ticket.accountId === accountId);
  }

  async all(): Promise<readonly QueueTicket[]> {
    return [...this.#tickets];
  }
}

/** Characters keyed by account and character id. A missing one is not the account's (QUE-03). */
export class FakeCharacters implements CharactersPort {
  readonly #characters = new Map<string, QueueCharacter>();

  /** A character's class defaults to a sorceress, the class the queue tests use. */
  set(
    accountId: string,
    characterId: string,
    character: EntryCharacter & { readonly characterClass?: CharacterClassName },
  ): void {
    this.#characters.set(`${accountId}|${characterId}`, {
      ...character,
      characterClass: character.characterClass ?? 'sorceress',
    });
  }

  async characterOf(accountId: string, characterId: string): Promise<QueueCharacter | null> {
    return this.#characters.get(`${accountId}|${characterId}`) ?? null;
  }
}

/** The open ready checks in a map; ended checks stay until pruned, as the adapter keeps them (RDY-06). */
export class InMemoryReadyChecks implements ReadyCheckStore {
  readonly #checks = new Map<string, ReadyCheck>();

  async put(check: ReadyCheck): Promise<void> {
    this.#checks.set(check.id, check);
  }

  async find(checkId: string): Promise<ReadyCheck | undefined> {
    return this.#checks.get(checkId);
  }

  async openOf(accountId: string): Promise<ReadyCheck | undefined> {
    return [...this.#checks.values()].find(
      (check) =>
        check.outcome === null && check.group.members.some((member) => member.accountId === accountId),
    );
  }

  async pruneEndedBefore(before: Date): Promise<void> {
    for (const [id, check] of this.#checks) {
      if (check.outcome !== null && check.deadline.getTime() < before.getTime()) {
        this.#checks.delete(id);
      }
    }
  }
}

/** The penalties the test records, in memory: `untilOf` answers what `record` last set for the account. */
export class InMemoryPenalties implements PenaltyStore {
  readonly #until = new Map<string, Date>();
  readonly recorded: Array<{ accountIds: readonly string[]; until: Date; reason: string }> = [];

  async untilOf(accountId: string): Promise<Date | undefined> {
    return this.#until.get(accountId);
  }

  async record(accountIds: readonly string[], until: Date, reason: 'ready-check-timeout'): Promise<void> {
    this.recorded.push({ accountIds: [...accountIds], until, reason });
    for (const accountId of accountIds) {
      this.#until.set(accountId, until);
    }
  }
}

/** The accounts whose presence, link, site stream or open room the test sets. */
export class FakeAccountFacts implements AgentPresencePort, AccountLinkPort, SiteConnectionsPort, RoomsPort {
  readonly #online = new Set<string>();
  readonly #linked = new Set<string>();
  readonly #siteOpen = new Set<string>();
  readonly #inRoom = new Set<string>();

  /** An account that passes every connection check. */
  readyToQueue(accountId: string): void {
    this.#online.add(accountId);
    this.#linked.add(accountId);
    this.#siteOpen.add(accountId);
  }

  setOnline(accountId: string, value: boolean): void {
    toggle(this.#online, accountId, value);
  }

  setLinked(accountId: string, value: boolean): void {
    toggle(this.#linked, accountId, value);
  }

  setSiteOpen(accountId: string, value: boolean): void {
    toggle(this.#siteOpen, accountId, value);
  }

  setInRoom(accountId: string, value: boolean): void {
    toggle(this.#inRoom, accountId, value);
  }

  async isOnline(accountId: string): Promise<boolean> {
    return this.#online.has(accountId);
  }

  async isLinked(accountId: string): Promise<boolean> {
    return this.#linked.has(accountId);
  }

  async hasSiteStream(accountId: string): Promise<boolean> {
    return this.#siteOpen.has(accountId);
  }

  async hasOpenRoom(accountId: string): Promise<boolean> {
    return this.#inRoom.has(accountId);
  }
}

function toggle(set: Set<string>, value: string, on: boolean): void {
  if (on) {
    set.add(value);
  } else {
    set.delete(value);
  }
}

/** Every character rates 1500 unless the test sets another rating (ADR 018). */
export class FixedRatings implements RatingsPort {
  readonly #ratings = new Map<string, number>();

  set(accountId: string, characterId: string, rating: number): void {
    this.#ratings.set(`${accountId}|${characterId}`, rating);
  }

  async ratingOf(accountId: string, characterId: string): Promise<number> {
    return this.#ratings.get(`${accountId}|${characterId}`) ?? 1500;
  }
}

/** The bus keeps every published event, in order. */
export class RecordingEventBus implements EventBus {
  readonly published: BusEvent[] = [];

  async publish(event: BusEvent): Promise<void> {
    this.published.push(event);
  }

  subscribe(): void {
    // Subscribers are not needed by the queue's unit tests.
  }

  /** The `QueueUpdated` updates published so far, as `{ accountId, update }`. */
  queueUpdates(): Array<{ accountId: string; update: unknown }> {
    return this.published.flatMap((event) =>
      event.event.type === 'QueueUpdated'
        ? [{ accountId: event.event.payload.accountId, update: event.event.payload.update }]
        : [],
    );
  }

  /** The ready checks opened so far (`ReadyCheckStarted`), in order. */
  readyChecksStarted(): ReadyCheckChangedPayload[] {
    return this.published.flatMap((event) =>
      event.event.type === 'ReadyCheckStarted' ? [event.event.payload] : [],
    );
  }

  /** The ready checks that ended so far (`ReadyCheckResolved`), in order. */
  readyChecksResolved(): ReadyCheckResolvedPayload[] {
    return this.published.flatMap((event) =>
      event.event.type === 'ReadyCheckResolved' ? [event.event.payload] : [],
    );
  }

  /** The reasons of the `left` updates published so far. */
  leaveReasons(): QueueLeaveReason[] {
    return this.queueUpdates().flatMap(({ update }) => {
      const value = update as { status?: string; reason?: QueueLeaveReason };
      return value.status === 'left' && value.reason !== undefined ? [value.reason] : [];
    });
  }
}

/** Records the metric calls the queue makes. */
export class RecordingQueueMetrics implements QueueMetrics {
  readonly sizes: Array<{ attributes: QueueAttributes; size: number }> = [];
  readonly waits: Array<{ attributes: QueueAttributes; seconds: number }> = [];
  readonly resolved: Array<'accepted' | 'declined' | 'timed-out'> = [];

  queueSize(attributes: QueueAttributes, size: number): void {
    this.sizes.push({ attributes, size });
  }

  waitAtMatch(attributes: QueueAttributes, seconds: number): void {
    this.waits.push({ attributes, seconds });
  }

  readyCheckResolved(outcome: 'accepted' | 'declined' | 'timed-out'): void {
    this.resolved.push(outcome);
  }
}
