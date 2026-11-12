import { describe, expect, it } from 'vitest';
import {
  compareJoinOrder,
  isLevelingTicket,
  isPvpTicket,
  poolKey,
  type LevelingTicket,
  type PvpTicket,
} from './queue-ticket.ts';

const T0 = new Date('2026-11-10T12:00:00.000Z');

function pvp(id: string, joinedAt: Date = T0): PvpTicket {
  return {
    id,
    accountId: `acc-${id}`,
    characterId: `char-${id}`,
    characterClass: 'sorceress',
    mode: 'pvp',
    region: 'americas',
    difficulty: 'hell',
    ladder: 'sc-ladder',
    era: 'rotw',
    rating: 1500,
    level: 90,
    joinedAt,
    pvp: { format: 'duel', rules: 'gm' },
  };
}

function leveling(id: string): LevelingTicket {
  return {
    id,
    accountId: `acc-${id}`,
    characterId: `char-${id}`,
    characterClass: 'sorceress',
    mode: 'leveling',
    region: 'europe',
    difficulty: 'nightmare',
    ladder: 'hc-ladder',
    era: 'lod',
    rating: 1500,
    level: 80,
    joinedAt: T0,
    leveling: { activity: 'baal', role: 'killer', minLevel: 70 },
  };
}

describe('ticket mode guards', () => {
  it('tells a PvP ticket from a leveling ticket', () => {
    expect(isPvpTicket(pvp('a'))).toBe(true);
    expect(isPvpTicket(leveling('a'))).toBe(false);
    expect(isLevelingTicket(leveling('a'))).toBe(true);
    expect(isLevelingTicket(pvp('a'))).toBe(false);
  });
});

describe('poolKey (QUE-07)', () => {
  it('joins the filters, then the format and rules of a PvP ticket, with a bar', () => {
    expect(poolKey(pvp('a'))).toBe('pvp|americas|hell|sc-ladder|rotw|duel|gm');
  });

  it('joins the filters, then the activity of a leveling ticket, with a bar', () => {
    expect(poolKey(leveling('a'))).toBe('leveling|europe|nightmare|hc-ladder|lod|baal');
  });
});

describe('compareJoinOrder', () => {
  it('orders the oldest first', () => {
    expect(compareJoinOrder(pvp('b', new Date(T0.getTime() - 1)), pvp('a'))).toBeLessThan(0);
    expect(compareJoinOrder(pvp('a'), pvp('b', new Date(T0.getTime() - 1)))).toBeGreaterThan(0);
  });

  it('breaks a tie on time by id, ascending', () => {
    expect(compareJoinOrder(pvp('a'), pvp('b'))).toBe(-1);
    expect(compareJoinOrder(pvp('b'), pvp('a'))).toBe(1);
    expect(compareJoinOrder(pvp('a'), pvp('a'))).toBe(0);
  });
});
