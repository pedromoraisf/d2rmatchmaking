import { describe, expect, it } from 'vitest';
import { MemoryAgentTokenCache } from './memory-agent-token-cache.ts';
import { MemoryPresenceStore } from './memory-presence-store.ts';
import { MemoryRateLimitStore } from './memory-rate-limit-store.ts';

const T0 = new Date('2026-10-30T12:00:00.000Z');
const MINUTE = 60 * 1000;

const identity = (n: number) => ({ agentId: `agent-${n}`, accountId: `account-${n}` });

describe('MemoryAgentTokenCache', () => {
  it('the 10 001st token evicts the least recently used', () => {
    const cache = new MemoryAgentTokenCache();
    for (let n = 0; n < 10_000; n += 1) {
      cache.set(`hash-${n}`, identity(n));
    }
    cache.get('hash-0');

    cache.set('hash-10000', identity(10_000));

    expect(cache.get('hash-1')).toBeUndefined();
    expect(cache.get('hash-0')).toEqual(identity(0));
    expect(cache.get('hash-10000')).toEqual(identity(10_000));
  });

  it('setting an existing token again does not evict another entry', () => {
    const cache = new MemoryAgentTokenCache(2);
    cache.set('a', identity(1));
    cache.set('b', identity(2));

    cache.set('a', identity(3));

    expect(cache.get('a')).toEqual(identity(3));
    expect(cache.get('b')).toEqual(identity(2));
  });

  it('invalidate removes the token at once', () => {
    const cache = new MemoryAgentTokenCache();
    cache.set('hash-1', identity(1));

    cache.invalidate('hash-1');

    expect(cache.get('hash-1')).toBeUndefined();
  });
});

describe('MemoryRateLimitStore', () => {
  it('prunes timestamps at or before the cutoff before the widest window', async () => {
    const store = new MemoryRateLimitStore();
    await store.record('ip:203.0.113.7', T0);
    await store.record('ip:203.0.113.7', new Date(T0.getTime() + 30 * MINUTE));

    await store.prune(new Date(T0.getTime() + 10 * MINUTE));

    expect(await store.timestamps('ip:203.0.113.7')).toEqual([new Date(T0.getTime() + 30 * MINUTE)]);
  });

  it('keeps records per key and returns nothing for an unknown key', async () => {
    const store = new MemoryRateLimitStore();
    await store.record('account:account-1', T0);

    expect(await store.timestamps('account:account-1')).toEqual([T0]);
    expect(await store.timestamps('account:account-2')).toEqual([]);
  });
});

describe('MemoryPresenceStore', () => {
  it('gets, sets and lists presence by agent', () => {
    const store = new MemoryPresenceStore();
    const presence = { online: true, gameRunning: false, screen: 'UNKNOWN' as const, lastSeenAt: T0 };

    expect(store.get('agent-1')).toBeUndefined();
    store.set({ agentId: 'agent-1', accountId: 'account-1', presence });

    expect(store.get('agent-1')).toEqual({ agentId: 'agent-1', accountId: 'account-1', presence });
    expect(store.list()).toHaveLength(1);
  });
});
