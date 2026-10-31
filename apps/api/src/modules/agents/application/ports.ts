import type { Agent } from '../domain/agent.ts';
import type { PairingCode } from '../domain/pairing-code.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';

/** Which table a secret belongs to: a value hashed for one domain never matches another (design.md § Identity). */
export type SecretDomain = 'session' | 'agent' | 'claim';

export interface SecretHasher {
  hash(domain: SecretDomain, value: string): string;
}

export interface AgentRepository {
  insert(tx: Transaction, agent: Agent): Promise<void>;
  save(tx: Transaction, agent: Agent): Promise<void>;
  findById(agentId: string): Promise<Agent | null>;
  findByClaimSecretHash(claimSecretHash: string): Promise<Agent | null>;
  /** The account's agent that is not revoked, if any. */
  findCurrentByAccount(accountId: string): Promise<Agent | null>;
  /**
   * One atomic statement: stores the token hash only when the agent is paired, not revoked and not claimed yet.
   * Returns the agent it claimed, or null when nothing was updated (design.md § Agents module, atomic claim).
   */
  claimTokenAtomically(
    claimSecretHash: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly agentId: string; readonly accountId: string } | null>;
}

export interface PairingCodeRepository {
  insert(tx: Transaction, code: PairingCode): Promise<void>;
  save(tx: Transaction, code: PairingCode): Promise<void>;
  /** The unused code with this value, if any. */
  findUnusedByCode(code: string): Promise<PairingCode | null>;
  findByAgentId(agentId: string): Promise<PairingCode | null>;
}

/** Timestamps of counted submissions per key (memory, ADR 006). */
export interface RateLimitStore {
  timestamps(key: string): Promise<Date[]>;
  record(key: string, at: Date): Promise<void>;
}

/** Cached token resolution: the agent and its account for a token hash (memory, ADR 006). */
export interface AgentTokenCache {
  get(tokenHash: string): { readonly agentId: string; readonly accountId: string } | undefined;
  set(tokenHash: string, value: { readonly agentId: string; readonly accountId: string }): void;
  invalidate(tokenHash: string): void;
}
