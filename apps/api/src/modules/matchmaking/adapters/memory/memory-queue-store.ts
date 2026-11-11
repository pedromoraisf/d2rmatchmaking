import type { QueueTicket } from '../../domain/queue-ticket/queue-ticket.ts';
import type { QueueStore } from '../../application/ports.ts';

/**
 * The queue in memory (ADR 006): the tickets in the order they joined, indexed by id and by account so a lookup never
 * scans the queue. A restart drops them, which the spec accepts; the player joins again. One process holds the queue, so
 * the serial lock of the use cases is the only writer ordering needed.
 */
export class MemoryQueueStore implements QueueStore {
  /** Map keeps insertion order, which is the join order the matcher reads (`all`). */
  readonly #byId = new Map<string, QueueTicket>();
  readonly #byAccount = new Map<string, QueueTicket>();

  async add(ticket: QueueTicket): Promise<void> {
    this.#byId.set(ticket.id, ticket);
    this.#byAccount.set(ticket.accountId, ticket);
  }

  async remove(ticketIds: readonly string[]): Promise<void> {
    for (const id of ticketIds) {
      const ticket = this.#byId.get(id);
      if (ticket === undefined) {
        continue;
      }
      this.#byId.delete(id);
      if (this.#byAccount.get(ticket.accountId) === ticket) {
        this.#byAccount.delete(ticket.accountId);
      }
    }
  }

  async find(ticketId: string): Promise<QueueTicket | undefined> {
    return this.#byId.get(ticketId);
  }

  async byAccount(accountId: string): Promise<QueueTicket | undefined> {
    return this.#byAccount.get(accountId);
  }

  async all(): Promise<readonly QueueTicket[]> {
    return [...this.#byId.values()];
  }

  /** The acceptance stack's reset empties the queue between scenarios (test controls, AD-045). */
  clear(): void {
    this.#byId.clear();
    this.#byAccount.clear();
  }
}
