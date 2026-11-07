import type { RoomStage, Transaction } from '../../../shared-kernel/index.ts';
import type { GameDifficulty } from '../domain/game-name.ts';
import type { LobbyRoom } from '../domain/lobby-room.ts';
import type { Observation } from '../domain/observation.ts';

export interface LobbyRoomRepository {
  insert(tx: Transaction, room: LobbyRoom): Promise<void>;
  save(tx: Transaction, room: LobbyRoom): Promise<void>;
  findById(roomId: string): Promise<LobbyRoom | null>;
  findByMatchId(matchId: string): Promise<LobbyRoom | null>;
  /** The room of the account with the highest game name number: the newest one (AWS-25, design.md § Lobby Room). */
  findNewestByAccount(accountId: string): Promise<LobbyRoom | null>;
  /** The instant the room opened in `awaiting_host` (`lobby.rooms.created_at`), or undefined for an unknown room. */
  openedAt(roomId: string): Promise<Date | undefined>;
}

/**
 * The W3C traceparent of the match that opened each room (RTL-01, RTL-08). Internal: it is read by the observation span
 * and never sent in a view or an event (RTL-07). The domain `LobbyRoom` holds no trace field.
 */
export interface RoomTraceContexts {
  /** Stores the traceparent of the span that opened the room, in the transaction that inserts the room. */
  record(tx: Transaction, roomId: string, traceparent: string): Promise<void>;
  /** The stored traceparent, or null for a room with none or an unknown room. */
  find(roomId: string): Promise<string | null>;
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

/** Room metrics the use cases report (OBS-34). The OpenTelemetry adapter lives in `adapters/telemetry`. */
export interface RoomMetrics {
  /** The seconds a room spent in `stage` before it left it, with the bounded attributes of the room (`room.stage_duration`). */
  stageLeft(stage: RoomStage, difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void;
}
