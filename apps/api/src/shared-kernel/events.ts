// Event and persistence ports shared by the modules and the platform (design.md § Shared kernel additions).
// Types only: the implementations live in platform/ (Postgres outbox and unit of work, in-memory bus).

/** Room stages of the glossary (`RoomStage`). */
export type RoomStage = 'formed' | 'awaiting_host' | 'created' | 'active' | 'closed' | 'expired';

/** Role of a member of a room or a match (glossary `Host`). */
export type MemberRole = 'host' | 'member';

/** A member of a match or a room, as docs/domain/events.md lists it. */
export interface MatchMember {
  readonly accountId: string;
  readonly characterId: string | null;
  readonly joinOrder: number;
  readonly role: MemberRole;
  /** The team of a 2v2 member (QUE-12); absent in every other group. */
  readonly team?: 'a' | 'b';
}

/** A domain event: its type name and its payload. */
export interface DomainEvent<T extends string = string, P = unknown> {
  readonly type: T;
  readonly payload: P;
}

export interface MatchFormedPayload {
  readonly matchId: string;
  readonly mode: 'pvp' | 'leveling';
  readonly activity: string;
  readonly difficulty: 'normal' | 'nightmare' | 'hell';
  readonly region: 'americas' | 'europe' | 'asia';
  readonly ladder: 'sc-ladder' | 'sc-nonladder' | 'hc-ladder' | 'hc-nonladder';
  readonly era: 'lod' | 'rotw' | 'classic';
  readonly members: readonly MatchMember[];
}

export interface RoomAssignmentChangedPayload {
  readonly roomId: string;
  readonly run: number;
  readonly expectedGameName: string;
  readonly members: readonly MatchMember[];
}

export interface RoomStageChangedPayload {
  readonly roomId: string;
  readonly stage: RoomStage;
  readonly members: readonly MatchMember[];
}

export interface AgentPresenceChangedPayload {
  readonly agentId: string;
  readonly accountId: string;
  readonly online: boolean;
  readonly gameRunning: boolean;
  readonly screen: 'UNKNOWN' | 'CHARACTER_SELECT' | 'IN_GAME' | 'AUTOMAP_OPEN';
}

export interface AgentRevokedPayload {
  readonly agentId: string;
  readonly accountId: string;
}

export interface CharactersRecordedPayload {
  readonly accountId: string;
}

/** Why a ticket left the queue without a match (QUE-13, QUE-14); a match is `matched`. */
export type QueueLeaveReason =
  'left-by-player' | 'matched' | 'agent-offline' | 'agent-revoked' | 'site-closed';

/** The options a ticket was joined with (QUE-01, QUE-02), as the site shows them. */
export type QueueOptionsSnapshot =
  | {
      readonly mode: 'pvp';
      readonly characterId: string;
      readonly difficulty: 'normal' | 'nightmare' | 'hell';
      readonly region: 'americas' | 'europe' | 'asia';
      readonly format: 'duel' | '2v2' | 'arena';
      readonly rules: 'gm' | 'bm';
    }
  | {
      readonly mode: 'leveling';
      readonly characterId: string;
      readonly difficulty: 'normal' | 'nightmare' | 'hell';
      readonly region: 'americas' | 'europe' | 'asia';
      readonly activity: 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds';
      readonly role: 'teleporter' | 'bo' | 'killer' | 'leech';
      readonly minLevel: number;
    };

/** A waiting ticket as the site shows it (contract `QueueTicketView`). */
export interface QueueTicketSnapshot {
  readonly id: string;
  readonly status: 'waiting';
  readonly mode: 'pvp' | 'leveling';
  readonly options: QueueOptionsSnapshot;
  readonly joinedAt: string;
  readonly band: { readonly low: number; readonly high: number } | null;
  readonly poolSize: number;
}

export interface QueueUpdatedPayload {
  readonly accountId: string;
  readonly update: QueueTicketSnapshot | { readonly status: 'left'; readonly reason: QueueLeaveReason };
}

/** Durable events, written to the outbox in the same transaction as the state change (ADR 008). */
export type MatchFormedEvent = DomainEvent<'MatchFormed', MatchFormedPayload>;
export type RoomAssignmentChangedEvent = DomainEvent<'RoomAssignmentChanged', RoomAssignmentChangedPayload>;
export type RoomStageChangedEvent = DomainEvent<'RoomStageChanged', RoomStageChangedPayload>;
export type CharactersRecordedEvent = DomainEvent<'CharactersRecorded', CharactersRecordedPayload>;

/** Transient events, published on the bus only and never stored. */
export type AgentPresenceChangedEvent = DomainEvent<'AgentPresenceChanged', AgentPresenceChangedPayload>;
export type AgentRevokedEvent = DomainEvent<'AgentRevoked', AgentRevokedPayload>;
export type QueueUpdatedEvent = DomainEvent<'QueueUpdated', QueueUpdatedPayload>;

/** Every event type of the feature. */
export type AnyDomainEvent =
  | MatchFormedEvent
  | RoomAssignmentChangedEvent
  | RoomStageChangedEvent
  | CharactersRecordedEvent
  | AgentPresenceChangedEvent
  | AgentRevokedEvent
  | QueueUpdatedEvent;

/** What the bus carries: durable events keep their outbox id, transient events have none. */
export type BusEvent =
  | { readonly kind: 'durable'; readonly id: bigint; readonly event: AnyDomainEvent }
  | { readonly kind: 'transient'; readonly event: AnyDomainEvent };

declare const transactionBrand: unique symbol;

/** An open unit of work. Opaque: only the platform's unit of work creates one. */
export type Transaction = { readonly [transactionBrand]: 'Transaction' };

/** Appends durable events to the outbox inside the given transaction. */
export interface Outbox {
  append(tx: Transaction, events: readonly AnyDomainEvent[]): Promise<void>;
}

/** Runs work in one transaction: commit on success, rollback when the work throws. */
export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Delivers events to subscribers in subscription order. */
export interface EventBus {
  publish(event: BusEvent): Promise<void>;
  subscribe(type: AnyDomainEvent['type'], handler: (event: BusEvent) => Promise<void> | void): void;
}
