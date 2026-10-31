import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { GameNameSequence } from '../../application/ports.ts';
import type { LobbyDatabase } from './schema.ts';

/** Hands out game name numbers from `lobby.game_name_seq` (design.md § Lobby Room module). */
export class PostgresGameNameSequence implements GameNameSequence {
  readonly #db: Kysely<LobbyDatabase>;

  constructor(db: Kysely<LobbyDatabase>) {
    this.#db = db;
  }

  async next(): Promise<number> {
    const result = await sql<{ n: string }>`select nextval('lobby.game_name_seq')::text as n`.execute(
      this.#db,
    );
    const value = result.rows[0]?.n;
    if (value === undefined) {
      throw new Error('lobby.game_name_seq returned no value');
    }
    return Number(value);
  }
}
