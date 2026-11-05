import { describe, expect, it } from 'vitest';
import type { RandomSource } from '../../../shared-kernel/random-source.ts';
import { PairingCode } from './pairing-code.ts';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const FIVE_MIN_MS = 5 * 60 * 1000;

function fixedRandom(value: number): RandomSource {
  return {
    int: () => value,
    bytes: (n) => new Uint8Array(n),
  };
}

describe('PairingCode.issue', () => {
  it('zero-pads the code to six digits', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(7), NOW);

    expect(code.code).toBe('000007');
  });

  it('expires exactly 5 minutes after issue', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(7), NOW);

    expect(code.expiresAt.getTime()).toBe(NOW.getTime() + FIVE_MIN_MS);
  });
});

describe('PairingCode.use', () => {
  it('binds the account before expiry', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(42), NOW);

    const used = code.use('account-1', new Date(NOW.getTime() + FIVE_MIN_MS - 1));

    expect(used.ok).toBe(true);
    if (used.ok) {
      expect(used.value.accountId).toBe('account-1');
      expect(used.value.claimState(new Date(NOW.getTime() + 1))).toBe('claimable');
    }
  });

  it('refuses the code at exactly its expiry', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(42), NOW);

    expect(code.use('account-1', new Date(NOW.getTime() + FIVE_MIN_MS))).toEqual({
      ok: false,
      error: 'invalid-code',
    });
  });

  it('refuses the code after its expiry', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(42), NOW);

    expect(code.use('account-1', new Date(NOW.getTime() + FIVE_MIN_MS + 1))).toEqual({
      ok: false,
      error: 'invalid-code',
    });
  });

  it('refuses a code that was already used', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(42), NOW);
    const first = code.use('account-1', NOW);
    if (!first.ok) {
      throw new Error('first use should succeed');
    }

    expect(first.value.use('account-2', NOW)).toEqual({ ok: false, error: 'invalid-code' });
  });
});

describe('PairingCode.claimState', () => {
  it('is pending while unused and unexpired, claimable once used, gone when it expired unused', () => {
    const code = PairingCode.issue('agent-1', fixedRandom(42), NOW);
    const used = code.use('account-1', NOW);
    if (!used.ok) {
      throw new Error('use should succeed');
    }

    expect(code.claimState(NOW)).toBe('pending');
    expect(used.value.claimState(new Date(NOW.getTime() + FIVE_MIN_MS * 10))).toBe('claimable');
    expect(code.claimState(new Date(NOW.getTime() + FIVE_MIN_MS))).toBe('gone');
  });
});
