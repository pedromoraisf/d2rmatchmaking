import type { Kysely } from 'kysely';
import type { Transaction, UnitOfWork } from '../../shared-kernel/index.ts';
import type { PostgresOutbox } from './outbox.ts';

/** What the unit of work needs from the relay: a nudge after a commit that appended outbox rows. */
export interface RelayWaker {
  wake(): void;
}

/**
 * Runs work in one Postgres transaction (commit on success, rollback when the work throws). After a commit that
 * appended outbox rows it calls `relay.wake()`; a rolled-back transaction wakes nothing (design.md § Platform).
 */
export class PostgresUnitOfWork<DB> implements UnitOfWork {
  readonly #db: Kysely<DB>;
  readonly #outbox: PostgresOutbox;
  readonly #relay: RelayWaker;

  constructor(db: Kysely<DB>, outbox: PostgresOutbox, relay: RelayWaker) {
    this.#db = db;
    this.#outbox = outbox;
    this.#relay = relay;
  }

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    let appended = false;
    const result = await this.#db.transaction().execute(async (trx) => {
      const token = trx as unknown as Transaction;
      const value = await work(token);
      appended = this.#outbox.appendedIn(token);
      return value;
    });
    if (appended) {
      this.#relay.wake();
    }
    return result;
  }
}
