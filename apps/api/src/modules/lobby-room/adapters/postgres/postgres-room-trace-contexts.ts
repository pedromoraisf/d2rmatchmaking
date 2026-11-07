import type { Kysely } from 'kysely';
import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { RoomTraceContexts } from '../../application/ports.ts';
import { executorOf } from './executor.ts';
import type { LobbyDatabase } from './schema.ts';

/** Kysely RoomTraceContexts: the room's traceparent in `lobby.rooms.trace_context` (RTL-08). */
export class PostgresRoomTraceContexts implements RoomTraceContexts {
  readonly #db: Kysely<LobbyDatabase>;

  constructor(db: Kysely<LobbyDatabase>) {
    this.#db = db;
  }

  async record(tx: Transaction, roomId: string, traceparent: string): Promise<void> {
    await executorOf(tx)
      .updateTable('lobby.rooms')
      .set({ trace_context: traceparent })
      .where('id', '=', roomId)
      .execute();
  }

  async find(roomId: string): Promise<string | null> {
    const row = await this.#db
      .selectFrom('lobby.rooms')
      .select('trace_context')
      .where('id', '=', roomId)
      .executeTakeFirst();
    return row?.trace_context ?? null;
  }
}
