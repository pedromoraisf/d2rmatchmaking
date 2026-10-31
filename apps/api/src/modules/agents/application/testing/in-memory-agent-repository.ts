import { Agent } from '../../domain/agent.ts';
import type { AgentRepository } from '../ports.ts';

/** In-memory AgentRepository. The claim mirrors the Postgres statement's conditions. */
export class InMemoryAgentRepository implements AgentRepository {
  readonly #agents = new Map<string, Agent>();

  async insert(_tx: unknown, agent: Agent): Promise<void> {
    this.#agents.set(agent.id, agent);
  }

  async save(_tx: unknown, agent: Agent): Promise<void> {
    this.#agents.set(agent.id, agent);
  }

  async findById(agentId: string): Promise<Agent | null> {
    return this.#agents.get(agentId) ?? null;
  }

  async findByClaimSecretHash(claimSecretHash: string): Promise<Agent | null> {
    return [...this.#agents.values()].find((agent) => agent.claimSecretHash === claimSecretHash) ?? null;
  }

  async findCurrentByAccount(accountId: string): Promise<Agent | null> {
    return (
      [...this.#agents.values()].find(
        (agent) => agent.accountId === accountId && agent.revokedAt === undefined,
      ) ?? null
    );
  }

  async claimTokenAtomically(
    claimSecretHash: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly agentId: string; readonly accountId: string } | null> {
    const agent = [...this.#agents.values()].find(
      (candidate) =>
        candidate.claimSecretHash === claimSecretHash &&
        candidate.tokenClaimedAt === undefined &&
        candidate.accountId !== undefined &&
        candidate.revokedAt === undefined,
    );
    if (agent === undefined || agent.accountId === undefined) {
      return null;
    }
    this.#agents.set(
      agent.id,
      new Agent({
        id: agent.id,
        claimSecretHash: agent.claimSecretHash,
        accountId: agent.accountId,
        tokenHash,
        tokenClaimedAt: now,
        pairedAt: agent.pairedAt,
      }),
    );
    return { agentId: agent.id, accountId: agent.accountId };
  }
}
