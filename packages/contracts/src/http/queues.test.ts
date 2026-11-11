import { describe, expect, it } from 'vitest';
import {
  JoinQueueRequest,
  MyQueueTicketResponse,
  QueueLeft,
  QueueRefusal,
  QueueTicketView,
} from './queues.ts';

const pvp = {
  mode: 'pvp',
  characterId: 'c-1',
  difficulty: 'hell',
  region: 'americas',
  format: 'duel',
  rules: 'gm',
};

const leveling = {
  mode: 'leveling',
  characterId: 'c-2',
  difficulty: 'nightmare',
  region: 'americas',
  activity: 'chaos',
  role: 'killer',
  minLevel: 40,
};

const ticket = {
  id: 'q-1',
  status: 'waiting',
  mode: 'pvp',
  options: pvp,
  joinedAt: '2026-11-10T12:00:00.000Z',
  band: { low: 1400, high: 1600 },
  poolSize: 2,
};

describe('JoinQueueRequest', () => {
  it('accepts a PvP join', () => {
    expect(JoinQueueRequest.parse(pvp)).toStrictEqual(pvp);
  });

  it('accepts a leveling join', () => {
    expect(JoinQueueRequest.parse(leveling)).toStrictEqual(leveling);
  });

  it.each([
    ['a format outside duel, 2v2 and arena', { ...pvp, format: '3v3' }],
    ['rules outside gm and bm', { ...pvp, rules: 'hc' }],
    ['a region outside the three', { ...pvp, region: 'oceania' }],
    ['a difficulty outside the three', { ...pvp, difficulty: 'inferno' }],
    ['an activity outside the five', { ...leveling, activity: 'mephisto' }],
    ['a role outside the four', { ...leveling, role: 'tank' }],
    ['a minimum level above 99', { ...leveling, minLevel: 100 }],
    ['a minimum level of 0', { ...leveling, minLevel: 0 }],
    ['an unknown mode', { ...pvp, mode: 'raid' }],
    ['no character', { ...pvp, characterId: undefined }],
  ])('rejects %s', (_label, body) => {
    expect(JoinQueueRequest.safeParse(body).success).toBe(false);
  });

  it('rejects a leveling join with the PvP fields only', () => {
    expect(
      JoinQueueRequest.safeParse({ mode: 'leveling', characterId: 'c-2', difficulty: 'hell', region: 'asia' })
        .success,
    ).toBe(false);
  });
});

describe('QueueTicketView', () => {
  it('accepts a waiting PvP ticket with its band', () => {
    expect(QueueTicketView.parse(ticket)).toStrictEqual(ticket);
  });

  it('accepts a leveling ticket with no band', () => {
    const levelingTicket = { ...ticket, mode: 'leveling', options: leveling, band: null };
    expect(QueueTicketView.parse(levelingTicket)).toStrictEqual(levelingTicket);
  });

  it('rejects a ticket that is not waiting', () => {
    expect(QueueTicketView.safeParse({ ...ticket, status: 'matched' }).success).toBe(false);
  });

  it('rejects a negative pool size', () => {
    expect(QueueTicketView.safeParse({ ...ticket, poolSize: -1 }).success).toBe(false);
  });
});

describe('MyQueueTicketResponse', () => {
  it('accepts a player with no ticket', () => {
    expect(MyQueueTicketResponse.parse({ ticket: null })).toStrictEqual({ ticket: null });
  });

  it('accepts a player with a ticket', () => {
    expect(MyQueueTicketResponse.parse({ ticket })).toStrictEqual({ ticket });
  });
});

describe('QueueLeft', () => {
  it.each(['left-by-player', 'matched', 'agent-offline', 'agent-revoked', 'site-closed'])(
    'accepts the reason %s',
    (reason) => {
      expect(QueueLeft.parse({ status: 'left', reason })).toStrictEqual({ status: 'left', reason });
    },
  );

  it('rejects a reason outside the five', () => {
    expect(QueueLeft.safeParse({ status: 'left', reason: 'timeout' }).success).toBe(false);
  });
});

describe('QueueRefusal', () => {
  it.each([
    'not-your-character',
    'undeclared-character',
    'difficulty-locked',
    'below-floor',
    'below-minimum-level',
    'minimum-below-floor',
    'activity-not-available',
    'agent-offline',
    'not-linked',
    'site-not-open',
    'already-queued',
    'in-room',
  ])('accepts the refusal %s', (error) => {
    expect(QueueRefusal.parse({ error })).toStrictEqual({ error });
  });

  it('accepts the ready-check penalty with the seconds left', () => {
    const refusal = { error: 'ready-check-penalty', secondsLeft: 300 };
    expect(QueueRefusal.parse(refusal)).toStrictEqual(refusal);
  });

  it('rejects a ready-check penalty with zero seconds left', () => {
    expect(QueueRefusal.safeParse({ error: 'ready-check-penalty', secondsLeft: 0 }).success).toBe(false);
  });

  it('rejects an unknown refusal code', () => {
    expect(QueueRefusal.safeParse({ error: 'bored' }).success).toBe(false);
  });
});
