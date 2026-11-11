/** The queue modes (glossary `Mode`). */
export type QueueMode = 'pvp' | 'leveling';

/** The game regions of the queues (QUE-07). */
export type QueueRegion = 'americas' | 'europe' | 'asia';

/** The difficulties of D2R (glossary). */
export type QueueDifficulty = 'normal' | 'nightmare' | 'hell';

/** The combined ladder value the glossary defines, derived from hardcore and the declared ladder flag (CHR-15). */
export type QueueLadder = 'sc-ladder' | 'sc-nonladder' | 'hc-ladder' | 'hc-nonladder';

/** The expansion eras (glossary). */
export type QueueEra = 'classic' | 'lod' | 'rotw';

/** The PvP formats (PRD § Escopo): group sizes 2, 4 and 6 (QUE-11). */
export type PvpFormat = 'duel' | '2v2' | 'arena';

export type PvpRules = 'gm' | 'bm';

/** The leveling activities (glossary). PvP tickets use the activity code `pvp` in events. */
export type Activity = 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds';

export type LevelingRole = 'teleporter' | 'bo' | 'killer' | 'leech';

export interface PvpOptions {
  readonly format: PvpFormat;
  readonly rules: PvpRules;
}

export interface LevelingOptions {
  readonly activity: Activity;
  readonly role: LevelingRole;
  readonly minLevel: number;
}

interface TicketCommon {
  readonly id: string;
  readonly accountId: string;
  readonly characterId: string;
  readonly region: QueueRegion;
  readonly difficulty: QueueDifficulty;
  readonly ladder: QueueLadder;
  readonly era: QueueEra;
  /** The rating the matcher bands on; the initial rating until Ranking exists (ADR 018). */
  readonly rating: number;
  /** The character's level when the ticket was joined (QUE-03, QUE-09). */
  readonly level: number;
  readonly joinedAt: Date;
}

export interface PvpTicket extends TicketCommon {
  readonly mode: 'pvp';
  readonly pvp: PvpOptions;
}

export interface LevelingTicket extends TicketCommon {
  readonly mode: 'leveling';
  readonly leveling: LevelingOptions;
}

/** A ticket waiting in the queue (design.md § Matchmaking module, domain). */
export type QueueTicket = PvpTicket | LevelingTicket;

export function isPvpTicket(ticket: QueueTicket): ticket is PvpTicket {
  return ticket.mode === 'pvp';
}

export function isLevelingTicket(ticket: QueueTicket): ticket is LevelingTicket {
  return ticket.mode === 'leveling';
}

/**
 * The filters a group may never cross (QUE-07): mode, region, difficulty, ladder and era, then the format and rules
 * (PvP) or the activity (leveling). Two tickets with different keys never match.
 */
export function poolKey(ticket: QueueTicket): string {
  const shared = [ticket.mode, ticket.region, ticket.difficulty, ticket.ladder, ticket.era];
  return isPvpTicket(ticket)
    ? [...shared, ticket.pvp.format, ticket.pvp.rules].join('|')
    : [...shared, ticket.leveling.activity].join('|');
}

/** The join order of tickets: the oldest first, then by id, so the matcher is deterministic (design.md). */
export function compareJoinOrder(a: QueueTicket, b: QueueTicket): number {
  const byTime = a.joinedAt.getTime() - b.joinedAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
