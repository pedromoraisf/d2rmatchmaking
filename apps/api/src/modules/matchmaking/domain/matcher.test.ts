import { describe, expect, it } from 'vitest';
import { formGroups, levelingCompatible, poolSizeOf, snakeTeams, type MatchProbe } from './matcher.ts';
import type {
  LevelingRole,
  LevelingTicket,
  PvpFormat,
  PvpRules,
  PvpTicket,
  QueueTicket,
} from './queue-ticket/queue-ticket.ts';
import { poolKey } from './queue-ticket/queue-ticket.ts';

const NOW = new Date('2026-11-10T12:10:00.000Z');
const SECOND = 1000;
/** A moment `seconds` before NOW. Tickets joined at NOW have the base band. */
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * SECOND);

interface PvpSpec {
  readonly id: string;
  readonly rating?: number;
  readonly joinedAt?: Date;
  readonly region?: 'americas' | 'europe' | 'asia';
  readonly difficulty?: 'normal' | 'nightmare' | 'hell';
  readonly ladder?: 'sc-ladder' | 'sc-nonladder' | 'hc-ladder' | 'hc-nonladder';
  readonly era?: 'classic' | 'lod' | 'rotw';
  readonly format?: PvpFormat;
  readonly rules?: PvpRules;
}

function pvp(spec: PvpSpec): PvpTicket {
  return {
    id: spec.id,
    accountId: `acc-${spec.id}`,
    characterId: `char-${spec.id}`,
    characterClass: 'sorceress',
    mode: 'pvp',
    region: spec.region ?? 'americas',
    difficulty: spec.difficulty ?? 'hell',
    ladder: spec.ladder ?? 'sc-ladder',
    era: spec.era ?? 'rotw',
    rating: spec.rating ?? 1500,
    level: 90,
    joinedAt: spec.joinedAt ?? NOW,
    pvp: { format: spec.format ?? 'duel', rules: spec.rules ?? 'gm' },
  };
}

interface LevelingSpec {
  readonly id: string;
  readonly level?: number;
  readonly minLevel?: number;
  readonly role?: LevelingRole;
  readonly joinedAt?: Date;
  readonly activity?: 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds';
  readonly region?: 'americas' | 'europe' | 'asia';
  readonly difficulty?: 'normal' | 'nightmare' | 'hell';
  readonly ladder?: 'sc-ladder' | 'sc-nonladder' | 'hc-ladder' | 'hc-nonladder';
  readonly era?: 'classic' | 'lod' | 'rotw';
}

function leveling(spec: LevelingSpec): LevelingTicket {
  return {
    id: spec.id,
    accountId: `acc-${spec.id}`,
    characterId: `char-${spec.id}`,
    characterClass: 'sorceress',
    mode: 'leveling',
    region: spec.region ?? 'americas',
    difficulty: spec.difficulty ?? 'hell',
    ladder: spec.ladder ?? 'sc-ladder',
    era: spec.era ?? 'rotw',
    rating: 1500,
    level: spec.level ?? 80,
    joinedAt: spec.joinedAt ?? NOW,
    leveling: {
      activity: spec.activity ?? 'baal',
      role: spec.role ?? 'killer',
      minLevel: spec.minLevel ?? 70,
    },
  };
}

/** A pool of `count` compatible duelists, joined at the same moment, all rated 1500. */
function duelists(count: number): PvpTicket[] {
  return Array.from({ length: count }, (_, index) => pvp({ id: `d${index + 1}` }));
}

const idsOf = (tickets: readonly QueueTicket[]) => tickets.map((ticket) => ticket.id);

describe('formGroups: PvP group sizes (QUE-11)', () => {
  it.each([
    ['duel', 2],
    ['2v2', 4],
    ['arena', 6],
  ] as const)('a %s group needs %i players', (format, size) => {
    const pool = Array.from({ length: size }, (_, index) => pvp({ id: `p${index + 1}`, format }));
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members).toHaveLength(size);
    expect(result.remaining).toHaveLength(0);
  });

  it.each([
    ['duel', 1],
    ['2v2', 3],
    ['arena', 5],
  ] as const)('a %s group does not form with one player fewer', (format, size) => {
    const pool = Array.from({ length: size }, (_, index) => pvp({ id: `p${index + 1}`, format }));
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(0);
    expect(result.remaining).toHaveLength(size);
  });

  it('takes the oldest tickets first and leaves the newest waiting (QUE-11)', () => {
    const pool = [
      pvp({ id: 'c', joinedAt: ago(10) }),
      pvp({ id: 'a', joinedAt: ago(30) }),
      pvp({ id: 'b', joinedAt: ago(20) }),
    ];
    const result = formGroups(pool, NOW);
    expect(idsOf(result.groups[0]?.members ?? [])).toStrictEqual(['a', 'b']);
    expect(idsOf(result.remaining)).toStrictEqual(['c']);
  });

  it('forms as many groups as the pool holds', () => {
    const result = formGroups(duelists(5), NOW);
    expect(result.groups).toHaveLength(2);
    expect(idsOf(result.remaining)).toStrictEqual(['d5']);
  });
});

describe('formGroups: filters never widen (QUE-07)', () => {
  it.each<[string, PvpSpec]>([
    ['region', { id: 'b', region: 'europe' }],
    ['difficulty', { id: 'b', difficulty: 'nightmare' }],
    ['ladder', { id: 'b', ladder: 'hc-ladder' }],
    ['ladder flag', { id: 'b', ladder: 'sc-nonladder' }],
    ['era', { id: 'b', era: 'lod' }],
    ['format', { id: 'b', format: 'arena' }],
    ['rules', { id: 'b', rules: 'bm' }],
  ])('two players differing only in %s never match', (_label, otherSpec) => {
    const pool = [pvp({ id: 'a', format: 'duel' }), pvp({ format: 'duel', ...otherSpec, id: 'b' })];
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(0);
    expect(result.remaining).toHaveLength(2);
  });

  it('two players identical in every filter match', () => {
    const result = formGroups([pvp({ id: 'a' }), pvp({ id: 'b' })], NOW);
    expect(result.groups).toHaveLength(1);
  });

  it('two leveling tickets with different activities never match', () => {
    const pool = [
      leveling({ id: 'a', activity: 'baal' }),
      leveling({ id: 'b', activity: 'chaos' }),
      ...levelingPool(7, 'baal', 'k'),
    ];
    const result = formGroups(pool, NOW);
    expect(result.groups.every((group) => group.activity === 'baal')).toBe(true);
    expect(idsOf(result.remaining)).toContain('b');
  });

  it('a leveling ticket and a PvP ticket never share a group', () => {
    const pool = [pvp({ id: 'a' }), leveling({ id: 'b' })];
    expect(formGroups(pool, NOW).groups).toHaveLength(0);
  });

  it('gives pool keys that differ exactly when a filter differs', () => {
    const base = pvp({ id: 'a' });
    expect(poolKey(base)).toBe(poolKey(pvp({ id: 'b' })));
    expect(poolKey(base)).not.toBe(poolKey(pvp({ id: 'b', region: 'asia' })));
    expect(poolKey(base)).not.toBe(poolKey(pvp({ id: 'b', rules: 'bm' })));
  });
});

describe('formGroups: PvP rating bands (QUE-08)', () => {
  it('matches two fresh tickets whose ratings differ by exactly 50', () => {
    const result = formGroups([pvp({ id: 'a', rating: 1500 }), pvp({ id: 'b', rating: 1550 })], NOW);
    expect(result.groups).toHaveLength(1);
  });

  it('refuses two fresh tickets whose ratings differ by 51', () => {
    const result = formGroups([pvp({ id: 'a', rating: 1500 }), pvp({ id: 'b', rating: 1551 })], NOW);
    expect(result.groups).toHaveLength(0);
  });

  it('is mutual: a waiting ticket does not reach a fresh one outside the fresh band', () => {
    const waiting = pvp({ id: 'w', rating: 1300, joinedAt: ago(600) });
    const fresh = pvp({ id: 'f', rating: 1500 });
    expect(formGroups([waiting, fresh], NOW).groups).toHaveLength(0);
  });

  it('matches once the waiting ticket band reaches the rating gap and the fresh one is wide enough', () => {
    const waiting = pvp({ id: 'w', rating: 1300, joinedAt: ago(600) });
    const other = pvp({ id: 'o', rating: 1600, joinedAt: ago(600) });
    expect(formGroups([waiting, other], NOW).groups).toHaveLength(1);
  });

  it('a 65 second wait widens the band to 100 each way (scenario "The PvP band widens")', () => {
    const waiting = pvp({ id: 'w', rating: 1500, joinedAt: ago(65) });
    const other = pvp({ id: 'o', rating: 1600, joinedAt: ago(65) });
    expect(formGroups([waiting, other], NOW).groups).toHaveLength(1);
    const tooFar = pvp({ id: 'x', rating: 1601, joinedAt: ago(65) });
    expect(formGroups([waiting, tooFar], NOW).groups).toHaveLength(0);
  });

  it('a group member must match every other member, not only the seed', () => {
    const seed = pvp({ id: 'a', rating: 1500, format: '2v2', joinedAt: ago(600) });
    const near = pvp({ id: 'b', rating: 1480, format: '2v2' });
    const far = pvp({ id: 'c', rating: 1600, format: '2v2' });
    const more = pvp({ id: 'd', rating: 1490, format: '2v2' });
    const result = formGroups([seed, near, far, more], NOW);
    expect(result.groups).toHaveLength(0);
  });
});

describe('formGroups: leveling (QUE-09)', () => {
  it('every member level is at least every member minimum', () => {
    expect(
      levelingCompatible([
        leveling({ id: 'a', level: 80, minLevel: 40 }),
        leveling({ id: 'b', level: 50, minLevel: 50 }),
      ]),
    ).toBe(true);
  });

  it('refuses a member whose level is under another member minimum', () => {
    expect(
      levelingCompatible([
        leveling({ id: 'a', level: 80, minLevel: 40 }),
        leveling({ id: 'b', level: 45, minLevel: 50 }),
      ]),
    ).toBe(false);
  });

  it('forms no group when a member minimum exceeds another member level', () => {
    const pool = [
      ...levelingPool(6, 'baal', 'k', { level: 80, minLevel: 70 }),
      leveling({ id: 'low', level: 75, minLevel: 40 }),
      leveling({ id: 'high', level: 80, minLevel: 78 }),
    ];
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(0);
  });

  it('forms a group of 8 from players who all meet the rule', () => {
    const result = formGroups(levelingPool(8, 'baal', 'k'), NOW);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members).toHaveLength(8);
    expect(result.groups[0]?.mode).toBe('leveling');
    expect(result.groups[0]?.activity).toBe('baal');
  });

  it('forms no group with 7 players', () => {
    expect(formGroups(levelingPool(7, 'baal', 'k'), NOW).groups).toHaveLength(0);
  });

  it('leaves a leveling player whose minimum is above the others out of the group', () => {
    const pool = [
      ...levelingPool(7, 'baal', 'k', { level: 80, minLevel: 60 }),
      leveling({ id: 'picky', level: 90, minLevel: 85 }),
      leveling({ id: 'extra', level: 80, minLevel: 60 }),
    ];
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(1);
    expect(idsOf(result.groups[0]?.members ?? [])).not.toContain('picky');
    expect(idsOf(result.remaining)).toContain('picky');
  });
});

describe('formGroups: teleporter and BO priority (QUE-10)', () => {
  it('includes the teleporter and the BO when the pool has them, with the teleporter as host', () => {
    const pool = [
      leveling({ id: 'k1', role: 'killer' }),
      leveling({ id: 'k2', role: 'killer' }),
      leveling({ id: 'k3', role: 'killer' }),
      leveling({ id: 'k4', role: 'killer' }),
      leveling({ id: 'k5', role: 'killer' }),
      leveling({ id: 'k6', role: 'killer' }),
      leveling({ id: 'k7', role: 'killer' }),
      leveling({ id: 'bo', role: 'bo' }),
      leveling({ id: 'tp', role: 'teleporter' }),
    ];
    const result = formGroups(pool, NOW);
    const group = result.groups[0];
    expect(group).toBeDefined();
    const roles = group?.members.map((member) => (member.mode === 'leveling' ? member.leveling.role : ''));
    expect(roles).toContain('teleporter');
    expect(roles).toContain('bo');
    expect(group?.hostTicketId).toBe('tp');
  });

  it('takes a teleporter who joined last over older killers', () => {
    const pool = [
      ...levelingPool(7, 'baal', 'k'),
      leveling({ id: 'tp', role: 'teleporter', joinedAt: ago(1) }),
    ];
    const group = formGroups(pool, NOW).groups[0];
    expect(idsOf(group?.members ?? [])).toContain('tp');
    expect(group?.hostTicketId).toBe('tp');
  });

  it('hosts with the oldest ticket when the group has no teleporter', () => {
    const group = formGroups(levelingPool(8, 'baal', 'k'), NOW).groups[0];
    expect(group?.hostTicketId).toBe('k1');
  });

  it('a group without a teleporter or BO in the pool still forms from killers', () => {
    const group = formGroups(levelingPool(8, 'baal', 'k'), NOW).groups[0];
    expect(
      group?.members.every((member) => member.mode === 'leveling' && member.leveling.role === 'killer'),
    ).toBe(true);
  });

  it('does not include a teleporter that is not compatible with the group', () => {
    const pool = [
      ...levelingPool(7, 'baal', 'k', { level: 80, minLevel: 60 }),
      leveling({ id: 'tp', role: 'teleporter', level: 50, minLevel: 40 }),
      leveling({ id: 'spare', level: 80, minLevel: 60 }),
    ];
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(1);
    expect(idsOf(result.groups[0]?.members ?? [])).not.toContain('tp');
  });
});

describe('formGroups: host and join order (QUE-12)', () => {
  it('lists members in join order and hosts the oldest PvP ticket', () => {
    const pool = [pvp({ id: 'late', joinedAt: ago(5) }), pvp({ id: 'early', joinedAt: ago(20) })];
    const group = formGroups(pool, NOW).groups[0];
    expect(idsOf(group?.members ?? [])).toStrictEqual(['early', 'late']);
    expect(group?.hostTicketId).toBe('early');
    expect(group?.activity).toBe('pvp');
    expect(group?.teams).toBeNull();
  });

  it('breaks a tie on join time by id, so the result never depends on the input order', () => {
    const a = pvp({ id: 'a' });
    const b = pvp({ id: 'b' });
    const forward = formGroups([a, b], NOW);
    const backward = formGroups([b, a], NOW);
    expect(forward).toStrictEqual(backward);
  });

  it('carries the region, difficulty, ladder and era of the group', () => {
    const group = formGroups(
      [
        pvp({ id: 'a', ladder: 'hc-ladder', era: 'lod', difficulty: 'nightmare' }),
        pvp({ id: 'b', ladder: 'hc-ladder', era: 'lod', difficulty: 'nightmare' }),
      ],
      NOW,
    ).groups[0];
    expect(group).toMatchObject({
      region: 'americas',
      difficulty: 'nightmare',
      ladder: 'hc-ladder',
      era: 'lod',
    });
  });
});

describe('formGroups: 2v2 teams (QUE-12)', () => {
  it('splits a 2v2 by snake draft over the ratings: strongest and fourth in A, second and third in B', () => {
    const pool = [
      pvp({ id: 'p1', rating: 1600, format: '2v2', joinedAt: ago(600) }),
      pvp({ id: 'p2', rating: 1550, format: '2v2', joinedAt: ago(600) }),
      pvp({ id: 'p3', rating: 1500, format: '2v2', joinedAt: ago(600) }),
      pvp({ id: 'p4', rating: 1450, format: '2v2', joinedAt: ago(600) }),
    ];
    const group = formGroups(pool, NOW).groups[0];
    expect(group?.teams).toStrictEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
  });

  it('snakeTeams orders each team by join order', () => {
    const members = [
      pvp({ id: 'z', rating: 1600, format: '2v2', joinedAt: ago(1) }),
      pvp({ id: 'y', rating: 1550, format: '2v2', joinedAt: ago(2) }),
      pvp({ id: 'x', rating: 1500, format: '2v2', joinedAt: ago(3) }),
      pvp({ id: 'w', rating: 1450, format: '2v2', joinedAt: ago(4) }),
    ];
    expect(snakeTeams(members)).toStrictEqual([
      ['w', 'z'],
      ['x', 'y'],
    ]);
  });

  it('gives no teams to a duel or an arena', () => {
    expect(formGroups(duelists(2), NOW).groups[0]?.teams).toBeNull();
    const arena = Array.from({ length: 6 }, (_, index) => pvp({ id: `r${index}`, format: 'arena' }));
    expect(formGroups(arena, NOW).groups[0]?.teams).toBeNull();
  });
});

describe('poolSizeOf', () => {
  it('counts the compatible tickets, the ticket itself included', () => {
    const tickets = [pvp({ id: 'a' }), pvp({ id: 'b' }), pvp({ id: 'c', region: 'asia' })];
    expect(poolSizeOf(tickets[0] as QueueTicket, tickets)).toBe(2);
    expect(poolSizeOf(tickets[2] as QueueTicket, tickets)).toBe(1);
  });
});

describe('formGroups: what is left', () => {
  it('returns the tickets no group took in join order', () => {
    const pool = [
      pvp({ id: 'b', region: 'americas', joinedAt: ago(10) }),
      pvp({ id: 'a', region: 'europe', joinedAt: ago(20) }),
      pvp({ id: 'c', region: 'asia', joinedAt: ago(30) }),
    ];
    const result = formGroups(pool, NOW);
    expect(result.groups).toHaveLength(0);
    expect(idsOf(result.remaining)).toStrictEqual(['c', 'a', 'b']);
  });

  it('forms nothing from an empty queue', () => {
    expect(formGroups([], NOW)).toStrictEqual({ groups: [], remaining: [] });
  });
});

/** `count` leveling players in one pool, all minimum 70 and level 80 unless overridden. */
function levelingPool(
  count: number,
  activity: 'baal' | 'chaos' | 'cows' | 'tz' | 'heralds',
  prefix: string,
  overrides: Partial<LevelingSpec> = {},
): LevelingTicket[] {
  return Array.from({ length: count }, (_, index) =>
    leveling({ id: `${prefix}${index + 1}`, activity, joinedAt: ago(100 - index), ...overrides }),
  );
}

describe('formGroups: the cost of a run (QUE-08)', () => {
  // The cost is bounded by the candidates a seed's band reaches, never by the square of the pool: 3,000 tickets in one
  // pool cost at most the pool size times the group size in band checks. Counted, not timed (no wall-clock limit).
  it('compares each seed with the ratings its band reaches only, so 3,000 unmatchable tickets cost O(n · group size)', () => {
    // Ratings 60 apart with every band at ±50: no two are within reach of each other, so nothing forms.
    const pool = Array.from({ length: 3000 }, (_, index) => pvp({ id: `s${index}`, rating: 60 * index }));
    const probe: MatchProbe = { bandChecks: 0 };

    const result = formGroups(pool, NOW, probe);

    expect(result.groups).toHaveLength(0);
    expect(result.remaining).toHaveLength(3000);
    expect(probe.bandChecks).toBeLessThanOrEqual(3000 * 2);
  });

  it('still pairs two tickets exactly on the band edge among 3,000 others', () => {
    const spaced = Array.from({ length: 3000 }, (_, index) => pvp({ id: `s${index}`, rating: 60 * index }));
    // 50 apart, far from the spaced ratings: each is the other's band edge.
    const pair = [pvp({ id: 'edge-a', rating: 300_000 }), pvp({ id: 'edge-b', rating: 300_050 })];

    const result = formGroups([...spaced, ...pair], NOW);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members.map((ticket) => ticket.id)).toStrictEqual(['edge-a', 'edge-b']);
    expect(result.remaining).toHaveLength(3000);
  });
});
