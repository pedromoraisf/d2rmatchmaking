import type { AgentsPort } from '../../../agents/index.ts';
import { err, type Result } from '../../../../shared-kernel/index.ts';

/**
 * Stands in for the Agents public port until its wiring lands (T31). Tests pair agents to accounts explicitly; the
 * token path is not used by the Lobby Room.
 */
export class FakeAgentsPort implements AgentsPort {
  readonly #accountByAgent = new Map<string, string>();

  pair(agentId: string, accountId: string): void {
    this.#accountByAgent.set(agentId, accountId);
  }

  async authenticateAgent(): Promise<
    Result<{ agentId: string; accountId: string }, 'unauthenticated' | 'throttled'>
  > {
    return err('unauthenticated');
  }

  async accountOfAgent(agentId: string): Promise<string | null> {
    return this.#accountByAgent.get(agentId) ?? null;
  }

  async currentAgentOf(accountId: string): Promise<string | null> {
    for (const [agentId, owner] of this.#accountByAgent) {
      if (owner === accountId) {
        return agentId;
      }
    }
    return null;
  }
}
