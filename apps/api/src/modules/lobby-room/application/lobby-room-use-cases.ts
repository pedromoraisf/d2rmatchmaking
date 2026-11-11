import {
  D2R_DIFFICULTY,
  D2R_QUEUE_MODE,
  D2R_ROOM_ACTIVITY,
  D2R_ROOM_ID,
  D2R_ROOM_RUN,
} from '@d2rmm/telemetry';
import type { AgentsPort } from '../../agents/index.ts';
import {
  activeTraceparent,
  annotateActiveSpan,
  err,
  linkActiveSpan,
  ok,
  withSpan,
  type CharacterClassName,
  type Clock,
  type IdGenerator,
  type MatchFormedPayload,
  type MatchMember,
  type Outbox,
  type Result,
  type RoomStage,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import { GameName } from '../domain/game-name.ts';
import { LobbyRoom, type RoomChange, type RoomMember } from '../domain/lobby-room.ts';
import { Observation, type ObservationType } from '../domain/observation.ts';
import type {
  GameNameSequence,
  LobbyRoomRepository,
  MemberConnectivity,
  ObservationRepository,
  RoomCharacters,
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
  readonly connectivity: MemberConnectivity;
  readonly characters: RoomCharacters;
  /** How long a member's agent may stay offline, or their site stream closed, before they leave the room (FR-32). */
  readonly dropToleranceMs: number;
}

/** A member as the room panel shows it: the room's member with the character's class and level. */
export interface RoomMemberSnapshot extends MatchMember {
  readonly confirmed: boolean;
  readonly class: CharacterClassName | null;
  readonly level: number | null;
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
  /** The reader's own account. */
  readonly you: string;
  readonly members: readonly RoomMemberSnapshot[];
  readonly runs: readonly { readonly run: number; readonly gameName: string }[];
  /** ISO instant the room expires if the host has not created the game, or null. */
  readonly expiresAt: string | null;
  /** ISO instant of the server's clock when the snapshot was read. */
  readonly serverNow: string;
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

/** Why the site's request on a room is refused: not the player's room, not the host, or not allowed in this stage. */
export type RoomActionError = 'not-found' | 'forbidden' | 'conflict';

function actionError(refusal: 'not-member' | 'not-host' | 'wrong-stage'): RoomActionError {
  switch (refusal) {
    case 'not-member':
      return 'not-found';
    case 'not-host':
      return 'forbidden';
    case 'wrong-stage':
      return 'conflict';
  }
}

/** A member without the room-only flag, as the assignment lists it. */
function toMatchMember(member: RoomMember): MatchMember {
  return {
    accountId: member.accountId,
    characterId: member.characterId,
    joinOrder: member.joinOrder,
    role: member.role,
    ...(member.team === undefined ? {} : { team: member.team }),
  };
}

/** One promise chain per key: the work of a key runs one after the other (rooms are in one process, ADR 006). */
function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  };
}

/** The span attributes of a room: ids and bounded enums only, never a name (LBR-13). */
function roomAttributes(room: LobbyRoom) {
  return {
    [D2R_ROOM_ID]: room.id,
    [D2R_ROOM_RUN]: room.currentRun,
    [D2R_DIFFICULTY]: room.difficulty,
    [D2R_ROOM_ACTIVITY]: room.activity,
    [D2R_QUEUE_MODE]: room.mode,
  };
}

function toAssignmentSnapshot(room: LobbyRoom): AssignmentSnapshot {
  return {
    roomId: room.id,
    run: room.currentRun,
    expectedGameName: room.gameName.value,
    members: room.members.map(toMatchMember),
  };
}

/**
 * The Lobby Room use cases (design.md § Lobby Room module). Each runs inside `withSpan('lobby.<use-case>')`; the
 * observation span is `lobby.record-observation` (AWS-35).
 */
export function createLobbyRoomUseCases(deps: LobbyRoomDeps) {
  const locked = createKeyedLock();

  /** Writes the changed room and its events in one transaction. */
  async function persist(change: RoomChange): Promise<void> {
    await deps.uow.run(async (tx) => {
      await deps.rooms.save(tx, change.room);
      await deps.outbox.append(tx, change.events);
    });
  }

  /** The metrics of a change: first `active` and the final stage (LBR-13). */
  async function report(before: LobbyRoom, after: LobbyRoom): Promise<void> {
    if (before.stage === after.stage) {
      return;
    }
    if (after.stage === 'active' && after.currentRun === 1) {
      const openedAt = await deps.rooms.openedAt(after.id);
      if (openedAt !== undefined) {
        const seconds = (deps.clock.now().getTime() - openedAt.getTime()) / 1000;
        deps.roomMetrics.timeToActive(after.difficulty, after.mode, seconds);
      }
    }
    if (after.stage === 'closed' || after.stage === 'expired') {
      deps.roomMetrics.finalStage(after.stage, after.difficulty, after.mode);
    }
  }

  /** Saves a change of a room and reports it. */
  async function apply(before: LobbyRoom, change: RoomChange): Promise<void> {
    await persist(change);
    await report(before, change.room);
  }

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
        annotateActiveSpan(roomAttributes(room));
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
   * The host's agent has the assignment (fetched it, or received `room.assigned` on its stream): a `formed` room moves
   * to `awaiting_host` and its 3 minutes start (LBR-02). Any other account or stage changes nothing.
   */
  async function deliverAssignment(roomId: string, accountId: string): Promise<void> {
    await locked(roomId, async () => {
      const room = await deps.rooms.findById(roomId);
      if (room === null) {
        return;
      }
      const change = room.markAssignmentDelivered(accountId, deps.clock.now());
      if (change !== null) {
        await apply(room, change);
      }
    });
  }

  function onAssignmentDelivered(input: { readonly accountId: string }): Promise<void> {
    return withSpan('lobby.on-assignment-delivered', {}, async () => {
      const room = await deps.rooms.findNewestByAccount(input.accountId);
      if (room === null || room.stage !== 'formed') {
        return;
      }
      annotateActiveSpan(roomAttributes(room));
      await deliverAssignment(room.id, input.accountId);
    });
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
        annotateActiveSpan(roomAttributes(room));
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
        await locked(room.id, async () => {
          // Read the room again under the lock: two agents' sightings of one room apply one after the other.
          const current = (await deps.rooms.findById(room.id)) ?? room;
          const transition = current.observe(observation);
          await deps.uow.run(async (tx) => {
            await deps.observations.insert(tx, observation);
            if (transition.outcome !== 'ignored') {
              await deps.rooms.save(tx, transition.room);
              await deps.outbox.append(tx, transition.events);
            }
          });
          if (transition.outcome === 'ignored') {
            return;
          }
          if (transition.outcome === 'created') {
            const openedAt = await deps.rooms.openedAt(room.id);
            if (openedAt !== undefined) {
              const seconds = (deps.clock.now().getTime() - openedAt.getTime()) / 1000;
              deps.roomMetrics.stageLeft('awaiting_host', room.difficulty, room.mode, seconds);
            }
          }
          await report(current, transition.room);
        });
        return ok({ stored: true });
      },
    );
  }

  /** Expires every room still `awaiting_host` 3 minutes after it entered that stage and releases its members (LBR-05). */
  function expireRooms(): Promise<number> {
    return withSpan('lobby.expire-rooms', {}, async (): Promise<number> => {
      let expired = 0;
      for (const open of await deps.rooms.findOpen()) {
        if (open.expireIfDue(deps.clock.now()) === null) {
          continue;
        }
        await locked(open.id, async () => {
          const room = await deps.rooms.findById(open.id);
          const change = room?.expireIfDue(deps.clock.now()) ?? null;
          if (room !== null && change !== null) {
            await apply(room, change);
            expired += 1;
          }
        });
      }
      return expired;
    });
  }

  /** The member the room tells to leave: their agent or site stream has been away for the whole tolerance (FR-32). */
  async function isAbsent(accountId: string): Promise<boolean> {
    const now = deps.clock.now().getTime();
    const agentSince = await deps.connectivity.agentOfflineSince(accountId);
    const siteSince = deps.connectivity.siteStreamClosedSince(accountId);
    return [agentSince, siteSince].some(
      (since) => since !== null && now - since.getTime() >= deps.dropToleranceMs,
    );
  }

  /** Makes every member who has been away for the tolerance leave their room, as if they had left on the site (LBR-08). */
  function dropAbsentMembers(): Promise<number> {
    return withSpan('lobby.drop-absent-members', {}, async (): Promise<number> => {
      let dropped = 0;
      for (const open of await deps.rooms.findOpen()) {
        await locked(open.id, async () => {
          let room = await deps.rooms.findById(open.id);
          for (const member of room?.members ?? []) {
            if (room === null || room.stage === 'closed' || room.stage === 'expired') {
              return;
            }
            if (!(await isAbsent(member.accountId))) {
              continue;
            }
            const left = room.leave(member.accountId);
            if (left.ok) {
              await apply(room, left.value);
              room = left.value.room;
              dropped += 1;
            }
          }
        });
      }
      return dropped;
    });
  }

  /**
   * Runs a host or member action on the player's room: loads it under the lock, refuses an unknown room or a player who
   * is not in it (`not-found`), applies the domain transition and saves it.
   */
  function roomAction(
    span: string,
    input: { readonly accountId: string; readonly roomId: string },
    transition: (
      room: LobbyRoom,
    ) => Promise<Result<RoomChange, 'not-member' | 'not-host' | 'wrong-stage' | 'unsupported'>>,
  ): Promise<Result<true, RoomActionError>> {
    return withSpan(span, { [D2R_ROOM_ID]: input.roomId }, () =>
      locked(input.roomId, async (): Promise<Result<true, RoomActionError>> => {
        const room = await deps.rooms.findById(input.roomId);
        if (room === null || !room.members.some((member) => member.accountId === input.accountId)) {
          return err('not-found');
        }
        annotateActiveSpan(roomAttributes(room));
        const result = await transition(room);
        if (!result.ok) {
          return err(result.error === 'unsupported' ? 'conflict' : actionError(result.error));
        }
        await apply(room, result.value);
        return ok(true);
      }),
    );
  }

  /** The host opens the next run of an active room: a new name from the sequence, confirmations cleared (LBR-06). */
  function openNextRun(input: { readonly accountId: string; readonly roomId: string }) {
    return roomAction('lobby.open-next-run', input, async (room) => {
      const name = GameName.of(room.activity, room.difficulty, await deps.sequence.next());
      if (!name.ok) {
        return err('unsupported');
      }
      return room.openNextRun(input.accountId, name.value, deps.clock.now());
    });
  }

  /** A member leaves the room; the host role passes on by join order (LBR-07). */
  function leaveRoom(input: { readonly accountId: string; readonly roomId: string }) {
    return roomAction('lobby.leave-room', input, (room) => Promise.resolve(room.leave(input.accountId)));
  }

  /** The host closes the room and releases every member (LBR-09). */
  function closeRoom(input: { readonly accountId: string; readonly roomId: string }) {
    return roomAction('lobby.close-room', input, (room) => Promise.resolve(room.close(input.accountId)));
  }

  /** The room as the account sees it, with the class and level of each member's character and the run history. */
  async function toRoomSnapshot(room: LobbyRoom, accountId: string): Promise<RoomSnapshot> {
    const members: RoomMemberSnapshot[] = [];
    for (const member of room.members) {
      const facts =
        member.characterId === null
          ? null
          : await deps.characters.characterOf(member.accountId, member.characterId);
      members.push({
        ...toMatchMember(member),
        confirmed: member.confirmed,
        class: facts?.characterClass ?? null,
        level: facts?.level ?? null,
      });
    }
    return {
      roomId: room.id,
      mode: room.mode,
      activity: room.activity,
      difficulty: room.difficulty,
      stage: room.stage,
      run: room.currentRun,
      expectedGameName: room.gameName.value,
      password: room.password,
      you: accountId,
      members,
      runs: await deps.rooms.runsOf(room.id),
      expiresAt: room.expiresAt?.toISOString() ?? null,
      serverNow: deps.clock.now().toISOString(),
    };
  }

  /** The newest room of the account, or null when it has none. */
  function getCurrentRoom(input: { readonly accountId: string }): Promise<RoomSnapshot | null> {
    return withSpan('lobby.get-current-room', {}, async () => {
      const room = await deps.rooms.findNewestByAccount(input.accountId);
      return room === null ? null : toRoomSnapshot(room, input.accountId);
    });
  }

  /**
   * The assignment of the agent's account's newest room, or null when the agent is unpaired or has no room. Fetching it
   * as the host of a `formed` room is the delivery that starts the 3 minutes (LBR-02).
   */
  function getAssignment(input: { readonly agentId: string }): Promise<AssignmentSnapshot | null> {
    return withSpan('lobby.get-assignment', {}, async () => {
      const accountId = await deps.agents.accountOfAgent(input.agentId);
      if (accountId === null) {
        return null;
      }
      const room = await deps.rooms.findNewestByAccount(accountId);
      if (room === null) {
        return null;
      }
      if (room.stage === 'formed' && room.hostAccountId === accountId) {
        await deliverAssignment(room.id, accountId);
      }
      return toAssignmentSnapshot(room);
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

  return {
    onMatchFormed,
    onAssignmentDelivered,
    recordObservation,
    expireRooms,
    dropAbsentMembers,
    openNextRun,
    leaveRoom,
    closeRoom,
    getCurrentRoom,
    getAssignment,
    hasOpenRoom,
  };
}

export type LobbyRoomUseCases = ReturnType<typeof createLobbyRoomUseCases>;
