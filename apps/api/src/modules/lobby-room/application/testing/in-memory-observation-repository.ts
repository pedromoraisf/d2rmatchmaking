import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { Observation } from '../../domain/observation.ts';
import type { ObservationRepository } from '../ports.ts';

/** In-memory ObservationRepository, keyed by agent and idempotency key as the Postgres primary key is (INV-09). */
export class InMemoryObservationRepository implements ObservationRepository {
  readonly #observations: Observation[] = [];

  /** Test helper: every stored observation, in insertion order. */
  get stored(): readonly Observation[] {
    return this.#observations;
  }

  async exists(agentId: string, idempotencyKey: string): Promise<boolean> {
    return this.#observations.some(
      (observation) => observation.agentId === agentId && observation.idempotencyKey === idempotencyKey,
    );
  }

  async insert(_tx: Transaction, observation: Observation): Promise<void> {
    this.#observations.push(observation);
  }
}
