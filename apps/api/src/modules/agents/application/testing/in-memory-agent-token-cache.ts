import type { AgentTokenCache } from '../ports.ts';

/** In-memory AgentTokenCache without a bound (the bounded LRU is the memory adapter's job). */
export class InMemoryAgentTokenCache implements AgentTokenCache {
  readonly #entries = new Map<string, { readonly agentId: string; readonly accountId: string }>();

  get(tokenHash: string): { readonly agentId: string; readonly accountId: string } | undefined {
    return this.#entries.get(tokenHash);
  }

  set(tokenHash: string, value: { readonly agentId: string; readonly accountId: string }): void {
    this.#entries.set(tokenHash, value);
  }

  invalidate(tokenHash: string): void {
    this.#entries.delete(tokenHash);
  }
}
