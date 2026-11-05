// The relay's egress budgets (OBS-14, design § Relay route and § Egress allowance): per account and relay-wide, a minute
// and a UTC day, charged as bytes stream and refunded when a forward is dropped.
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared-kernel/index.ts';
import { RelayBudget } from './relay-budget.ts';

const START = new Date('2026-11-02T12:00:00.000Z');
const MINUTE = 60 * 1000;
const MIB = 1024 * 1024;

function setup() {
  const clock = new FakeClock(START);
  return { clock, budget: new RelayBudget(clock) };
}

describe('RelayBudget', () => {
  it('refuses the sixty-first request in a minute', () => {
    const { budget, clock } = setup();

    for (let i = 0; i < 60; i += 1) {
      expect(budget.admit('account-1')).toEqual({ outcome: 'allowed' });
    }
    expect(budget.admit('account-1')).toEqual({ outcome: 'refused', retryAfterSeconds: 60 });

    clock.advance(MINUTE);
    expect(budget.admit('account-1')).toEqual({ outcome: 'allowed' });
  });

  it('an agent and its account share one budget', () => {
    const { budget } = setup();
    // The relay resolves an agent to its account before it asks the budget, so both calls use the account's key.
    const accountOfAgent = (agentId: string): string => (agentId === 'agent-7' ? 'account-1' : 'account-9');

    for (let i = 0; i < 30; i += 1) {
      expect(budget.admit(accountOfAgent('agent-7'))).toEqual({ outcome: 'allowed' });
    }
    for (let i = 0; i < 30; i += 1) {
      expect(budget.admit('account-1')).toEqual({ outcome: 'allowed' });
    }

    expect(budget.admit(accountOfAgent('agent-7'))).toMatchObject({ outcome: 'refused' });
    expect(budget.admit('account-9')).toEqual({ outcome: 'allowed' });
  });

  it('refuses past the daily relay allowance until midnight UTC', () => {
    const { budget, clock } = setup();

    // Eight accounts, 2 MiB each, one minute apart: the relay's minute budget never fills, its day budget does.
    for (let i = 0; i < 8; i += 1) {
      expect(budget.charge(`account-${i}`, 2 * MIB)).toEqual({ outcome: 'allowed' });
      clock.advance(MINUTE + 1000);
    }

    const midnight = Date.UTC(2026, 10, 3, 0, 0, 0);
    const refused = budget.charge('account-8', 1);
    expect(refused).toEqual({
      outcome: 'refused',
      retryAfterSeconds: Math.ceil((midnight - clock.now().getTime()) / 1000),
    });

    clock.set(new Date(midnight));
    expect(budget.charge('account-8', 1)).toEqual({ outcome: 'allowed' });
  });

  it('refunds bytes of a dropped forward', () => {
    const { budget } = setup();

    expect(budget.charge('account-1', 2 * MIB)).toEqual({ outcome: 'allowed' });
    expect(budget.charge('account-1', 1)).toMatchObject({ outcome: 'refused' });

    budget.refund('account-1', 2 * MIB);

    expect(budget.charge('account-1', MIB)).toEqual({ outcome: 'allowed' });
  });
});
