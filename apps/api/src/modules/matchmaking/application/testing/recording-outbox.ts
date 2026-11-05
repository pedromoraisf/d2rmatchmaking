import type { AnyDomainEvent, Outbox, Transaction } from '../../../../shared-kernel/index.ts';

/** Outbox that keeps every appended event, in order. */
export class RecordingOutbox implements Outbox {
  readonly appended: AnyDomainEvent[] = [];

  async append(_tx: Transaction, events: readonly AnyDomainEvent[]): Promise<void> {
    this.appended.push(...events);
  }
}
