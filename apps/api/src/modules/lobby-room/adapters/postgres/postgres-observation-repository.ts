import type { Kysely } from 'kysely';
import type { Clock, Transaction } from '../../../../shared-kernel/index.ts';
import type { Observation } from '../../domain/observation.ts';
import type { ObservationRepository } from '../../application/ports.ts';
import { executorOf } from './executor.ts';
import type { LobbyDatabase } from './schema.ts';

/** Kysely ObservationRepository. The primary key `(agent_id, idempotency_key)` makes the key per agent (INV-09). */
export class PostgresObservationRepository implements ObservationRepository {
  readonly #db: Kysely<LobbyDatabase>;
  readonly #clock: Clock;

  constructor(db: Kysely<LobbyDatabase>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async exists(agentId: string, idempotencyKey: string): Promise<boolean> {
    const row = await this.#db
      .selectFrom('lobby.observations')
      .select('agent_id')
      .where('agent_id', '=', agentId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return row !== undefined;
  }

  async insert(tx: Transaction, observation: Observation): Promise<void> {
    await executorOf(tx)
      .insertInto('lobby.observations')
      .values({
        agent_id: observation.agentId,
        idempotency_key: observation.idempotencyKey,
        room_id: observation.roomId,
        type: observation.type,
        run: observation.run,
        value: observation.value,
        confidence: observation.confidence,
        captured_at: observation.capturedAt,
        received_at: this.#clock.now(),
      })
      .execute();
  }
}
