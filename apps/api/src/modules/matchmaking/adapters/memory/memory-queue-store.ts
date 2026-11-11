import type { QueueTicket } from '../../domain/queue-ticket/queue-ticket.ts';
import type { QueueStore } from '../../application/ports.ts';

/**
 * The queue in memory (ADR 006): the tickets in the order they joined. A restart drops them, which the spec accepts; the
 * player joins again. One process holds the queue, so the serial lock of the use cases is the only writer ordering needed.
 */
export class MemoryQueueStore implements QueueStore {
  readonly #tickets: QueueTicket[] = [];

  async add(ticket: QueueTicket): Promise<void> {
    this.#tickets.push(ticket);
  }

  async remove(ticketIds: readonly string[]): Promise<void> {
    const gone = new Set(ticketIds);
    for (let index = this.#tickets.length - 1; index >= 0; index -= 1) {
      const ticket = this.#tickets[index];
      if (ticket !== undefined && gone.has(ticket.id)) {
        this.#tickets.splice(index, 1);
      }
    }
  }

  async find(ticketId: string): Promise<QueueTicket | undefined> {
    return this.#tickets.find((ticket) => ticket.id === ticketId);
  }

  async byAccount(accountId: string): Promise<QueueTicket | undefined> {
    return this.#tickets.find((ticket) => ticket.accountId === accountId);
  }

  async all(): Promise<readonly QueueTicket[]> {
    return [...this.#tickets];
  }

  /** The acceptance stack's reset empties the queue between scenarios (test controls, AD-045). */
  clear(): void {
    this.#tickets.length = 0;
  }
}
