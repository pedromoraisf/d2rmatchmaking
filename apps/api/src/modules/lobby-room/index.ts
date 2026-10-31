import type { LobbyRoomUseCases } from './application/lobby-room-use-cases.ts';

export { createLobbyRoomUseCases } from './application/lobby-room-use-cases.ts';
export type {
  AssignmentSnapshot,
  LobbyRoomDeps,
  LobbyRoomUseCases,
  ObservationBody,
  RecordObservationError,
  RoomSnapshot,
} from './application/lobby-room-use-cases.ts';
export type { GameNameSequence, LobbyRoomRepository, ObservationRepository } from './application/ports.ts';

/** The Lobby Room public port: the use cases the platform's subscribers and route plugins call (design.md § Lobby Room). */
export type LobbyRoomPort = LobbyRoomUseCases;
