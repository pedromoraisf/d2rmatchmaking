import { isMember, type ReadyCheck } from '../../domain/ready-check/ready-check.ts';
import type { ReadyCheckStore } from '../../application/ports.ts';

/**
 * The open ready checks in memory (ADR 006, RDY-09): a restart drops them, and the members' queue tickets with them. A
 * check that ended stays until `pruneEndedBefore` drops it, so a late answer is refused as ended (RDY-06).
 */
export class MemoryReadyCheckStore implements ReadyCheckStore {
  readonly #checks = new Map<string, ReadyCheck>();

  async put(check: ReadyCheck): Promise<void> {
    this.#checks.set(check.id, check);
  }

  async find(checkId: string): Promise<ReadyCheck | undefined> {
    return this.#checks.get(checkId);
  }

  async openOf(accountId: string): Promise<ReadyCheck | undefined> {
    return [...this.#checks.values()].find((check) => check.outcome === null && isMember(check, accountId));
  }

  async pruneEndedBefore(before: Date): Promise<void> {
    for (const [id, check] of this.#checks) {
      if (check.outcome !== null && check.deadline.getTime() < before.getTime()) {
        this.#checks.delete(id);
      }
    }
  }

  /** Every check the store holds, for the test reset (`main/test-controls.ts`). */
  clear(): void {
    this.#checks.clear();
  }
}
