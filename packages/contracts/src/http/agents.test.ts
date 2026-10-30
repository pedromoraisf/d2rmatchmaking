import { describe, expect, it } from 'vitest';
import { AgentView, ClaimRequest, ClaimResponse, Heartbeat, PairingCodeResponse } from './agents.ts';

const heartbeat = {
  agentVersion: '0.3.1',
  pcState: 'IN_ROOM_JOINING',
  game: { running: true, window: 'foreground', screen: 'AUTOMAP_OPEN' },
  assignment: { roomId: '4821', run: 7 },
  capture: { method: 'window', readRate: 0.97 },
};

describe('PairingCodeResponse', () => {
  it('accepts the pairing code example', () => {
    const body = {
      code: '123456',
      expiresAt: '2026-10-30T12:05:00.000Z',
      claimSecret: 'c'.repeat(43),
    };
    expect(PairingCodeResponse.parse(body)).toStrictEqual(body);
  });

  it('rejects a code that is not 6 digits', () => {
    const body = { code: '12345', expiresAt: '2026-10-30T12:05:00.000Z', claimSecret: 'secret' };
    expect(PairingCodeResponse.safeParse(body).success).toBe(false);
  });
});

describe('ClaimRequest', () => {
  it('accepts a claim secret', () => {
    expect(ClaimRequest.parse({ claimSecret: 'secret' })).toStrictEqual({ claimSecret: 'secret' });
  });

  it('rejects an empty claim secret', () => {
    expect(ClaimRequest.safeParse({ claimSecret: '' }).success).toBe(false);
  });
});

describe('ClaimResponse', () => {
  it('accepts an agent token of the d2rmm_a_ form', () => {
    const token = `d2rmm_a_${'A'.repeat(43)}`;
    expect(ClaimResponse.parse({ token })).toStrictEqual({ token });
  });

  it('rejects a token without the agent prefix', () => {
    expect(ClaimResponse.safeParse({ token: `d2rmm_s_${'A'.repeat(43)}` }).success).toBe(false);
  });
});

describe('Heartbeat', () => {
  it('accepts the heartbeat example', () => {
    expect(Heartbeat.parse(heartbeat)).toStrictEqual(heartbeat);
  });

  it('rejects an unknown screen', () => {
    const body = { ...heartbeat, game: { ...heartbeat.game, screen: 'INVENTORY' } };
    expect(Heartbeat.safeParse(body).success).toBe(false);
  });

  it('rejects a version that is not semantic', () => {
    expect(Heartbeat.safeParse({ ...heartbeat, agentVersion: 'v1.0' }).success).toBe(false);
  });

  it('rejects a read rate above 1', () => {
    const body = { ...heartbeat, capture: { method: 'window', readRate: 1.1 } };
    expect(Heartbeat.safeParse(body).success).toBe(false);
  });
});

describe('AgentView', () => {
  it('accepts the none state', () => {
    expect(AgentView.parse({ status: 'none' })).toStrictEqual({ status: 'none' });
  });

  it('accepts a paired agent with its presence', () => {
    const view = {
      status: 'paired',
      agentId: '7f0c0c3e-agent',
      online: true,
      gameRunning: false,
      screen: 'UNKNOWN',
      lastSeenAt: '2026-10-30T12:00:00.000Z',
    };
    expect(AgentView.parse(view)).toStrictEqual(view);
  });

  it('rejects an unknown status', () => {
    expect(AgentView.safeParse({ status: 'revoked' }).success).toBe(false);
  });
});
