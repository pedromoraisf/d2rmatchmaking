import type { Transaction } from '../../../shared-kernel/index.ts';
import type { LobbyRoom } from '../domain/lobby-room.ts';
import type { Observation } from '../domain/observation.ts';

export interface LobbyRoomRepository {
  insert(tx: Transaction, room: LobbyRoom): Promise<void>;
  save(tx: Transaction, room: LobbyRoom): Promise<void>;
  findById(roomId: string): Promise<LobbyRoom | null>;
  findByMatchId(matchId: string): Promise<LobbyRoom | null>;
  /** The room of the account with the highest game name number: the newest one (AWS-25, design.md § Lobby Room). */
  findNewestByAccount(accountId: string): Promise<LobbyRoom | null>;
}

export interface ObservationRepository {
  /** True when this agent already stored an observation with this idempotency key (INV-09). */
  exists(agentId: string, idempotencyKey: string): Promise<boolean>;
  insert(tx: Transaction, observation: Observation): Promise<void>;
}

/** Hands out the next game name number (Postgres `lobby.game_name_seq` in production). */
export interface GameNameSequence {
  next(): Promise<number>;
}
