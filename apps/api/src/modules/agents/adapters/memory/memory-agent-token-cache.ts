import type { AgentTokenCache } from '../../application/ports.ts';

export const TOKEN_CACHE_MAX_ENTRIES = 10_000;

type Identity = { readonly agentId: string; readonly accountId: string };

/**
 * Token hash to agent identity, bounded to 10 000 entries with least-recently-used eviction (ADR 006). A `get` counts
 * as a use; `invalidate` removes the entry at once (revocation).
 */
export class MemoryAgentTokenCache implements AgentTokenCache {
  readonly #entries = new Map<string, Identity>();
  readonly #maxEntries: number;

  constructor(maxEntries: number = TOKEN_CACHE_MAX_ENTRIES) {
    this.#maxEntries = maxEntries;
  }

  get(tokenHash: string): Identity | undefined {
    const identity = this.#entries.get(tokenHash);
    if (identity !== undefined) {
      this.#entries.delete(tokenHash);
      this.#entries.set(tokenHash, identity);
    }
    return identity;
  }

  set(tokenHash: string, value: Identity): void {
    this.#entries.delete(tokenHash);
    this.#entries.set(tokenHash, value);
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
  }

  invalidate(tokenHash: string): void {
    this.#entries.delete(tokenHash);
  }
}
