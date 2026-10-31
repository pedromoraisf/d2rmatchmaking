import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { LobbyRoom } from '../../domain/lobby-room.ts';
import type { LobbyRoomRepository } from '../ports.ts';

/** In-memory LobbyRoomRepository. The transaction token is ignored. */
export class InMemoryLobbyRoomRepository implements LobbyRoomRepository {
  readonly #rooms = new Map<string, LobbyRoom>();

  async insert(_tx: Transaction, room: LobbyRoom): Promise<void> {
    this.#rooms.set(room.id, room);
  }

  async save(_tx: Transaction, room: LobbyRoom): Promise<void> {
    this.#rooms.set(room.id, room);
  }

  async findById(roomId: string): Promise<LobbyRoom | null> {
    return this.#rooms.get(roomId) ?? null;
  }

  async findByMatchId(matchId: string): Promise<LobbyRoom | null> {
    return [...this.#rooms.values()].find((room) => room.matchId === matchId) ?? null;
  }

  async findNewestByAccount(accountId: string): Promise<LobbyRoom | null> {
    const rooms = [...this.#rooms.values()].filter((room) =>
      room.members.some((member) => member.accountId === accountId),
    );
    let newest: LobbyRoom | null = null;
    for (const room of rooms) {
      if (newest === null || room.gameName.number > newest.gameName.number) {
        newest = room;
      }
    }
    return newest;
  }
}
