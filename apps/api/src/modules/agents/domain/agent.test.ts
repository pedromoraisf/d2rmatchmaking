import { describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('Agent', () => {
  it('pairs to an account and records when', () => {
    const agent = new Agent({ id: 'agent-1', claimSecretHash: 'h-claim' }).pair('account-1', NOW);

    expect(agent.accountId).toBe('account-1');
    expect(agent.pairedAt?.getTime()).toBe(NOW.getTime());
  });

  it('is active when a token hash is present and not revoked', () => {
    const agent = new Agent({ id: 'agent-1', claimSecretHash: 'h-claim', tokenHash: 'h-token' });

    expect(agent.isActive()).toBe(true);
  });

  it('is not active without a claimed token', () => {
    const agent = new Agent({ id: 'agent-1', claimSecretHash: 'h-claim' });

    expect(agent.isActive()).toBe(false);
  });

  it('revoke makes isActive false', () => {
    const agent = new Agent({ id: 'agent-1', claimSecretHash: 'h-claim', tokenHash: 'h-token' });

    const revoked = agent.revoke(NOW);

    expect(revoked.isActive()).toBe(false);
    expect(revoked.revokedAt?.getTime()).toBe(NOW.getTime());
  });
});
