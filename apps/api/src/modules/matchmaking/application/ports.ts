import type { EntryCharacter } from '../domain/entry-rules.ts';
import type { QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';

/** The queue, in memory (ADR 006): the tickets waiting now. A restart drops them (spec, out of scope). */
export interface QueueStore {
  add(ticket: QueueTicket): Promise<void>;
  /** Removes the tickets with these ids; an id that is not queued is ignored. */
  remove(ticketIds: readonly string[]): Promise<void>;
  find(ticketId: string): Promise<QueueTicket | undefined>;
  byAccount(accountId: string): Promise<QueueTicket | undefined>;
  all(): Promise<readonly QueueTicket[]>;
}

/** Identity's character of an account (CHR-09, CHR-15). Null when the character is not the account's (QUE-03). */
export interface CharactersPort {
  characterOf(accountId: string, characterId: string): Promise<EntryCharacter | null>;
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
}
