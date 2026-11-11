// The matcher (QUE-07 … QUE-12). Pure and deterministic: `now` is a parameter, tickets are ordered by join order, and
// the same input always forms the same groups.
import { bandAt, bandsMatch } from './band.ts';
import {
  compareJoinOrder,
  isLevelingTicket,
  isPvpTicket,
  poolKey,
  type Activity,
  type LevelingTicket,
  type PvpFormat,
  type PvpTicket,
  type QueueDifficulty,
  type QueueEra,
  type QueueLadder,
  type QueueMode,
  type QueueRegion,
  type QueueTicket,
} from './queue-ticket/queue-ticket.ts';

/** Players per group (QUE-11): a duel 2, a 2v2 4, an arena 6, a leveling group 8. */
export const PVP_GROUP_SIZE: Readonly<Record<PvpFormat, number>> = { duel: 2, '2v2': 4, arena: 6 };
export const LEVELING_GROUP_SIZE = 8;

/** A group the matcher formed: its members in join order, its host and, in 2v2, the two balanced teams (QUE-12). */
export interface FormedGroup {
  readonly mode: QueueMode;
  /** `pvp` for PvP groups (design.md), otherwise the leveling activity. */
  readonly activity: 'pvp' | Activity;
  readonly region: QueueRegion;
  readonly difficulty: QueueDifficulty;
  readonly ladder: QueueLadder;
  readonly era: QueueEra;
  readonly members: readonly QueueTicket[];
  readonly hostTicketId: string;
  /** The two teams of a 2v2, as ticket ids; null for every other group. */
  readonly teams: readonly [readonly string[], readonly string[]] | null;
}

export interface MatchResult {
  readonly groups: readonly FormedGroup[];
  /** The tickets no group took, in join order. */
  readonly remaining: readonly QueueTicket[];
}

/**
 * Counts the band comparisons of a run (QUE-08), for the matcher's cost tests. A seed compares only the candidates its
 * band reaches, so the count is bounded by the candidates in reach times the group size, never by the square of the pool.
 */
export interface MatchProbe {
  bandChecks: number;
}

/** Forms every group the pool holds now. Tickets of different pool keys never meet (QUE-07). */
export function formGroups(
  tickets: readonly QueueTicket[],
  now: Date,
  probe: MatchProbe = { bandChecks: 0 },
): MatchResult {
  const buckets = new Map<string, QueueTicket[]>();
  for (const ticket of [...tickets].sort(compareJoinOrder)) {
    const key = poolKey(ticket);
    const bucket = buckets.get(key) ?? [];
    bucket.push(ticket);
    buckets.set(key, bucket);
  }
  const groups: FormedGroup[] = [];
  const remaining: QueueTicket[] = [];
  for (const bucket of buckets.values()) {
    const result = formInBucket(bucket, now, probe);
    groups.push(...result.groups);
    remaining.push(...result.remaining);
  }
  return { groups, remaining: remaining.sort(compareJoinOrder) };
}

/** How many tickets of the same pool wait, the ticket itself included (the site's "players in the same pool"). */
export function poolSizeOf(ticket: QueueTicket, tickets: readonly QueueTicket[]): number {
  const key = poolKey(ticket);
  return tickets.filter((other) => poolKey(other) === key).length;
}

/** The waiting count of every pool that holds a ticket, counted in one pass (the matcher's per-tick sizes). */
export function poolCounts(tickets: readonly QueueTicket[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    const key = poolKey(ticket);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formInBucket(
  bucket: readonly QueueTicket[],
  now: Date,
  probe: MatchProbe,
): { groups: FormedGroup[]; remaining: QueueTicket[] } {
  const groups: FormedGroup[] = [];
  // The bucket's tickets by rating, kept in step with `pool`: a PvP seed reads only the ratings its band reaches.
  let byRating = [...bucket].sort((a, b) => a.rating - b.rating || compareJoinOrder(a, b));
  let pool = bucket;
  for (;;) {
    const members = findGroup(pool, byRating, now, probe);
    if (members === null) {
      return { groups, remaining: [...pool] };
    }
    groups.push(toFormedGroup(members));
    const taken = new Set(members.map((member) => member.id));
    pool = pool.filter((ticket) => !taken.has(ticket.id));
    byRating = byRating.filter((ticket) => !taken.has(ticket.id));
  }
}

/** The first seed, oldest first, that fills a group from the pool. */
function findGroup(
  pool: readonly QueueTicket[],
  byRating: readonly QueueTicket[],
  now: Date,
  probe: MatchProbe,
): QueueTicket[] | null {
  for (const seed of pool) {
    const members = isPvpTicket(seed)
      ? fillPvp(seed, reachableBy(seed, byRating, now), now, probe)
      : fillLeveling(seed, pool);
    if (members !== null) {
      return members;
    }
  }
  return null;
}

/**
 * The PvP tickets a seed can match at all, in join order: a candidate matches only when its rating lies in the seed's
 * band (QUE-08), so the ratings outside that band are never compared. Found by binary search over the ratings.
 */
function reachableBy(seed: PvpTicket, byRating: readonly QueueTicket[], now: Date): PvpTicket[] {
  const { low, high } = bandAt(seed.rating, seed.joinedAt, now);
  let lo = 0;
  let hi = byRating.length;
  while (lo < hi) {
    const middle = (lo + hi) >> 1;
    if ((byRating[middle]?.rating ?? Number.POSITIVE_INFINITY) < low) {
      lo = middle + 1;
    } else {
      hi = middle;
    }
  }
  const reach: PvpTicket[] = [];
  for (let index = lo; index < byRating.length; index += 1) {
    const candidate = byRating[index];
    if (candidate === undefined || candidate.rating > high) {
      break;
    }
    if (isPvpTicket(candidate) && candidate.id !== seed.id) {
      reach.push(candidate);
    }
  }
  return reach.sort(compareJoinOrder);
}

function fillPvp(
  seed: PvpTicket,
  candidates: readonly PvpTicket[],
  now: Date,
  probe: MatchProbe,
): PvpTicket[] | null {
  const size = PVP_GROUP_SIZE[seed.pvp.format];
  const members: PvpTicket[] = [seed];
  for (const candidate of candidates) {
    if (members.length === size) {
      break;
    }
    const fits = members.every((member) => {
      probe.bandChecks += 1;
      return bandsMatch(member, candidate, now);
    });
    if (fits) {
      members.push(candidate);
    }
  }
  return members.length === size ? members : null;
}

function fillLeveling(seed: LevelingTicket, pool: readonly QueueTicket[]): QueueTicket[] | null {
  const members: LevelingTicket[] = [seed];
  const includes = (ticket: QueueTicket) => members.some((member) => member.id === ticket.id);

  // The teleporter and the BO come first, one of each the pool has (QUE-10).
  for (const role of ['teleporter', 'bo'] as const) {
    if (members.some((member) => member.leveling.role === role)) {
      continue;
    }
    const pick = pool.find(
      (candidate): candidate is LevelingTicket =>
        isLevelingTicket(candidate) &&
        candidate.leveling.role === role &&
        !includes(candidate) &&
        levelingCompatible([...members, candidate]),
    );
    if (pick !== undefined) {
      members.push(pick);
    }
  }

  for (const candidate of pool) {
    if (members.length === LEVELING_GROUP_SIZE) {
      break;
    }
    if (!isLevelingTicket(candidate) || includes(candidate)) {
      continue;
    }
    if (levelingCompatible([...members, candidate])) {
      members.push(candidate);
    }
  }
  return members.length === LEVELING_GROUP_SIZE ? members : null;
}

/** Every member's character level is at least every member's chosen minimum (QUE-09). */
export function levelingCompatible(members: readonly LevelingTicket[]): boolean {
  const lowestLevel = Math.min(...members.map((member) => member.level));
  const highestMinimum = Math.max(...members.map((member) => member.leveling.minLevel));
  return lowestLevel >= highestMinimum;
}

function toFormedGroup(tickets: readonly QueueTicket[]): FormedGroup {
  const members = [...tickets].sort(compareJoinOrder);
  const first = members[0];
  if (first === undefined) {
    throw new Error('a formed group has at least one member');
  }
  const common = {
    region: first.region,
    difficulty: first.difficulty,
    ladder: first.ladder,
    era: first.era,
  };
  if (isPvpTicket(first)) {
    const teams = first.pvp.format === '2v2' ? snakeTeams(members) : null;
    return {
      ...common,
      mode: 'pvp',
      activity: 'pvp',
      members,
      hostTicketId: first.id,
      teams,
    };
  }
  const teleporter = members.find(
    (member) => isLevelingTicket(member) && member.leveling.role === 'teleporter',
  );
  return {
    ...common,
    mode: 'leveling',
    activity: first.leveling.activity,
    members,
    hostTicketId: (teleporter ?? first).id,
    teams: null,
  };
}

/** A 2v2 split by a snake draft over the ratings, strongest first: A, B, B, A (QUE-12). */
export function snakeTeams(members: readonly QueueTicket[]): readonly [readonly string[], readonly string[]] {
  const byRating = [...members].sort((a, b) => b.rating - a.rating || compareJoinOrder(a, b));
  const teamA: QueueTicket[] = [];
  const teamB: QueueTicket[] = [];
  byRating.forEach((ticket, index) => {
    const toA = index % 4 === 0 || index % 4 === 3;
    (toA ? teamA : teamB).push(ticket);
  });
  const byJoin = (team: QueueTicket[]) => team.sort(compareJoinOrder).map((ticket) => ticket.id);
  return [byJoin(teamA), byJoin(teamB)];
}
