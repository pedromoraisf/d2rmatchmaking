import { D2R_ROOM_ID } from '@d2rmm/telemetry';
import type { AgentsPort } from '../../agents/index.ts';
import {
  activeTraceparent,
  err,
  linkActiveSpan,
  ok,
  withSpan,
  type Clock,
  type IdGenerator,
  type MatchFormedPayload,
  type MatchMember,
  type Outbox,
  type Result,
  type RoomStage,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import { LobbyRoom } from '../domain/lobby-room.ts';
import { Observation, type ObservationType } from '../domain/observation.ts';
import type {
  GameNameSequence,
  LobbyRoomRepository,
  ObservationRepository,
  RoomMetrics,
  RoomTraceContexts,
} from './ports.ts';

export interface LobbyRoomDeps {
  readonly rooms: LobbyRoomRepository;
  readonly observations: ObservationRepository;
  readonly sequence: GameNameSequence;
  readonly agents: AgentsPort;
  readonly ids: IdGenerator;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly roomMetrics: RoomMetrics;
  readonly traceContexts: RoomTraceContexts;
}

/** A room as a site member sees it (contract `RoomView`). */
export interface RoomSnapshot {
  readonly roomId: string;
  readonly mode: 'pvp' | 'leveling';
  readonly activity: string;
  readonly difficulty: 'normal' | 'nightmare' | 'hell';
  readonly stage: RoomStage;
  readonly run: number;
  readonly expectedGameName: string;
  readonly password: '';
  readonly members: readonly MatchMember[];
}

/** What an agent reads to know the game name it must find (contract `Assignment`). */
export interface AssignmentSnapshot {
  readonly roomId: string;
  readonly run: number;
  readonly expectedGameName: string;
  readonly members: readonly MatchMember[];
}

/** A raw observation body after the contract parse: an unknown type arrives as `UNKNOWN`. */
export interface ObservationBody {
  readonly idempotencyKey: string;
  readonly type: ObservationType | 'UNKNOWN';
  readonly run: number;
  readonly value: string;
  readonly confidence: number;
  readonly capturedAt: Date;
}

export type RecordObservationError = 'forbidden' | 'invalid-observation';

function toRoomSnapshot(room: LobbyRoom): RoomSnapshot {
  return {
    roomId: room.id,
    mode: room.mode,
    activity: room.activity,
    difficulty: room.difficulty,
    stage: room.stage,
    run: room.currentRun,
    expectedGameName: room.gameName.value,
    password: room.password,
    members: room.members,
  };
}

function toAssignmentSnapshot(room: LobbyRoom): AssignmentSnapshot {
  return {
    roomId: room.id,
    run: room.currentRun,
    expectedGameName: room.gameName.value,
    members: room.members,
  };
}

/**
 * The Lobby Room use cases (design.md § Lobby Room module). Each runs inside `withSpan('lobby.<use-case>')`; the
 * observation span is `lobby.record-observation` (AWS-35).
 */
export function createLobbyRoomUseCases(deps: LobbyRoomDeps) {
  /**
   * Opens one room for a `MatchFormed`. A match that already has a room creates no second one (idempotent by
   * `matchId`). The room and its two events are written in one transaction.
   */
  function onMatchFormed(
    match: MatchFormedPayload,
  ): Promise<Result<'created' | 'already-created', 'unsupported-difficulty'>> {
    return withSpan(
      'lobby.on-match-formed',
      { mode: match.mode },
      async (): Promise<Result<'created' | 'already-created', 'unsupported-difficulty'>> => {
        const existing = await deps.rooms.findByMatchId(match.matchId);
        if (existing !== null) {
          return ok('already-created');
        }
        const n = await deps.sequence.next();
        const opened = LobbyRoom.fromMatch(match, n, deps.ids);
        if (!opened.ok) {
          return err('unsupported-difficulty');
        }
        const { room, events } = opened.value;
        // The span active here is `lobby.on-match-formed`, the outbox relay of `MatchFormed` (RTL-01, RTL-02).
        const traceparent = activeTraceparent();
        await deps.uow.run(async (tx) => {
          await deps.rooms.insert(tx, room);
          await deps.outbox.append(tx, events);
          if (traceparent !== null) {
            await deps.traceContexts.record(tx, room.id, traceparent);
          }
        });
        return ok('created');
      },
    );
  }

  /**
   * Stores one observation of the agent's account for a room it belongs to, in this order: membership (403, nothing
   * stored) → unknown type (202, nothing stored) → idempotency key already stored for this agent (202, no change) →
   * insert and `observe` in one transaction (202).
   */
  function recordObservation(input: {
    readonly agentId: string;
    readonly roomId: string;
    readonly body: ObservationBody;
  }): Promise<Result<{ readonly stored: boolean }, RecordObservationError>> {
    return withSpan(
      'lobby.record-observation',
      { [D2R_ROOM_ID]: input.roomId },
      async (): Promise<Result<{ readonly stored: boolean }, RecordObservationError>> => {
        const accountId = await deps.agents.accountOfAgent(input.agentId);
        const room = await deps.rooms.findById(input.roomId);
        const isMember =
          accountId !== null &&
          room !== null &&
          room.members.some((member) => member.accountId === accountId);
        if (accountId === null || room === null || !isMember) {
          return err('forbidden');
        }
        // The span links to the match that opened the room, for a repeated or UNKNOWN observation too (RTL-03, RTL-04).
        const traceparent = await deps.traceContexts.find(room.id);
        if (traceparent !== null) {
          linkActiveSpan(traceparent);
        }
        const { body } = input;
        if (body.type === 'UNKNOWN') {
          return ok({ stored: false });
        }
        if (await deps.observations.exists(input.agentId, body.idempotencyKey)) {
          return ok({ stored: false });
        }
        const made = Observation.of({
          agentId: input.agentId,
          idempotencyKey: body.idempotencyKey,
          roomId: room.id,
          accountId,
          type: body.type,
          run: body.run,
          value: body.value,
          confidence: body.confidence,
          capturedAt: body.capturedAt,
        });
        if (!made.ok) {
          return err('invalid-observation');
        }
        const observation = made.value;
        const transition = room.observe(observation);
        await deps.uow.run(async (tx) => {
          await deps.observations.insert(tx, observation);
          if (transition.outcome === 'created') {
            await deps.rooms.save(tx, transition.room);
            await deps.outbox.append(tx, transition.events);
          }
        });
        if (transition.outcome === 'created') {
          const openedAt = await deps.rooms.openedAt(room.id);
          if (openedAt !== undefined) {
            const seconds = (deps.clock.now().getTime() - openedAt.getTime()) / 1000;
            deps.roomMetrics.stageLeft('awaiting_host', room.difficulty, room.mode, seconds);
          }
        }
        return ok({ stored: true });
      },
    );
  }

  /** The newest room of the account, or null when it has none. */
  function getCurrentRoom(input: { readonly accountId: string }): Promise<RoomSnapshot | null> {
    return withSpan('lobby.get-current-room', {}, async () => {
      const room = await deps.rooms.findNewestByAccount(input.accountId);
      return room === null ? null : toRoomSnapshot(room);
    });
  }

  /** The assignment of the agent's account's newest room, or null when the agent is unpaired or has no room. */
  function getAssignment(input: { readonly agentId: string }): Promise<AssignmentSnapshot | null> {
    return withSpan('lobby.get-assignment', {}, async () => {
      const accountId = await deps.agents.accountOfAgent(input.agentId);
      if (accountId === null) {
        return null;
      }
      const room = await deps.rooms.findNewestByAccount(accountId);
      return room === null ? null : toAssignmentSnapshot(room);
    });
  }

  /**
   * True when the account is a member of its newest room and that room is still open: neither closed nor expired. The
   * queues refuse a join while it holds (INV-04, QUE-06).
   */
  function hasOpenRoom(accountId: string): Promise<boolean> {
    return withSpan('lobby.has-open-room', {}, async (): Promise<boolean> => {
      const room = await deps.rooms.findNewestByAccount(accountId);
      if (room === null || room.stage === 'closed' || room.stage === 'expired') {
        return false;
      }
      return room.members.some((member) => member.accountId === accountId);
    });
  }

  return { onMatchFormed, recordObservation, getCurrentRoom, getAssignment, hasOpenRoom };
}

export type LobbyRoomUseCases = ReturnType<typeof createLobbyRoomUseCases>;
