import type { Transaction, UnitOfWork } from '../../../../shared-kernel/index.ts';

/** Runs the work with an opaque transaction token; the in-memory outbox ignores it. */
export class InMemoryUnitOfWork implements UnitOfWork {
  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work({} as Transaction);
  }
}
