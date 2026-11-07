import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { RoomTraceContexts } from '../ports.ts';

/** In-memory RoomTraceContexts, keyed by room id. The transaction token is ignored, as in the other in-memory fakes. */
export class InMemoryRoomTraceContexts implements RoomTraceContexts {
  readonly #contexts = new Map<string, string>();

  async record(_tx: Transaction, roomId: string, traceparent: string): Promise<void> {
    this.#contexts.set(roomId, traceparent);
  }

  async find(roomId: string): Promise<string | null> {
    return this.#contexts.get(roomId) ?? null;
  }
}
