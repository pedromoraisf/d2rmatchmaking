import type { PairingCode } from '../../domain/pairing-code.ts';
import type { PairingCodeRepository } from '../ports.ts';

/** In-memory PairingCodeRepository keyed by agent. */
export class InMemoryPairingCodeRepository implements PairingCodeRepository {
  readonly #codes = new Map<string, PairingCode>();

  async insert(_tx: unknown, code: PairingCode): Promise<void> {
    this.#codes.set(code.agentId, code);
  }

  async save(_tx: unknown, code: PairingCode): Promise<void> {
    this.#codes.set(code.agentId, code);
  }

  async findUnusedByCode(code: string): Promise<PairingCode | null> {
    return (
      [...this.#codes.values()].find(
        (candidate) => candidate.code === code && candidate.usedAt === undefined,
      ) ?? null
    );
  }

  async findByAgentId(agentId: string): Promise<PairingCode | null> {
    return this.#codes.get(agentId) ?? null;
  }
}
