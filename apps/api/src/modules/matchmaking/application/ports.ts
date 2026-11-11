import type { EntryCharacter } from '../domain/entry-rules.ts';
import type { ReadyCheck } from '../domain/ready-check/ready-check.ts';
import type { QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';
import type { CharacterClassName } from '../../../shared-kernel/index.ts';

/** The queue, in memory (ADR 006): the tickets waiting now. A restart drops them (spec, out of scope). */
export interface QueueStore {
  add(ticket: QueueTicket): Promise<void>;
  /** Removes the tickets with these ids; an id that is not queued is ignored. */
  remove(ticketIds: readonly string[]): Promise<void>;
  find(ticketId: string): Promise<QueueTicket | undefined>;
  byAccount(accountId: string): Promise<QueueTicket | undefined>;
  all(): Promise<readonly QueueTicket[]>;
}

/** The times each account's joins were attempted, for the joins-per-minute limit (QUE-18). */
export interface JoinLimitStore {
  timestamps(accountId: string): Promise<readonly Date[]>;
  /** Records one attempt that was allowed; the store keeps only what the window still counts. */
  record(accountId: string, at: Date): Promise<void>;
}

/** The facts of a character a join reads: the entry facts (QUE-03) and its class, the mark a ready check shows (RDY-01). */
export interface QueueCharacter extends EntryCharacter {
  readonly characterClass: CharacterClassName;
}

/** Identity's character of an account (CHR-09, CHR-15). Null when the character is not the account's (QUE-03). */
export interface CharactersPort {
  characterOf(accountId: string, characterId: string): Promise<QueueCharacter | null>;
}

/**
 * The penalties of the accounts that did not answer a ready check (RDY-05, RDY-09): Postgres, so a restart keeps them.
 * An account holds at most one penalty; a newer one replaces it.
 */
export interface PenaltyStore {
  /** The instant the account's penalty ends, or undefined when the account holds none. */
  untilOf(accountId: string): Promise<Date | undefined>;
  /** Records the penalty of each account, ending at `until`. */
  record(accountIds: readonly string[], until: Date, reason: 'ready-check-timeout'): Promise<void>;
}

/**
 * The open ready checks, in memory (ADR 006, RDY-09). A check that ended stays for a while, so an answer that comes late
 * is refused as ended (409) rather than as unknown (404, RDY-06).
 */
export interface ReadyCheckStore {
  put(check: ReadyCheck): Promise<void>;
  find(checkId: string): Promise<ReadyCheck | undefined>;
  /** The open check the account is a member of, if any: a member of an open check may not queue again (INV-04). */
  openOf(accountId: string): Promise<ReadyCheck | undefined>;
  /** Drops the ended checks whose deadline is before `before`, so the store does not grow for ever. */
  pruneEndedBefore(before: Date): Promise<void>;
}

/** Whether the account's paired agent is online now (QUE-05, FR-31). */
export interface AgentPresencePort {
  isOnline(accountId: string): Promise<boolean>;
}

/** Whether the account has a Battle.net account linked, or is a test account while staging endpoints are on (QUE-05). */
export interface AccountLinkPort {
  isLinked(accountId: string): Promise<boolean>;
}

/** Whether the account's site stream is open now (QUE-05, QUE-14). */
export interface SiteConnectionsPort {
  hasSiteStream(accountId: string): Promise<boolean>;
}

/** Whether the account is a member of an open room (QUE-06, INV-04). */
export interface RoomsPort {
  hasOpenRoom(accountId: string): Promise<boolean>;
}

/** The rating a ticket is banded on: 1500 for every character until Ranking exists (ADR 018, spec decisions). */
export interface RatingsPort {
  ratingOf(accountId: string, characterId: string): Promise<number>;
}

/** The bounded attributes of queue metrics and spans (QUE-16): no account or character name. */
export interface QueueAttributes {
  readonly mode: 'pvp' | 'leveling';
  readonly difficulty: 'normal' | 'nightmare' | 'hell';
  readonly ladder: 'sc-ladder' | 'sc-nonladder' | 'hc-ladder' | 'hc-nonladder';
  readonly era: 'classic' | 'lod' | 'rotw';
}

/** Queue metrics the use cases report (QUE-16). The OpenTelemetry adapter lives in `adapters/telemetry`. */
export interface QueueMetrics {
  /** The number of tickets waiting in the pool with these attributes, after a change (`d2r.queue.size`). */
  queueSize(attributes: QueueAttributes, size: number): void;
  /** The seconds a ticket waited when it left the queue in a match (`d2r.queue.wait`). */
  waitAtMatch(attributes: QueueAttributes, seconds: number): void;
  /** A ready check ended with this outcome (`d2r.ready_check.resolved`, RDY-10). */
  readyCheckResolved(outcome: 'accepted' | 'declined' | 'timed-out'): void;
}
