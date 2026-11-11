import {
  err,
  ok,
  type AnyDomainEvent,
  type IdGenerator,
  type MatchFormedPayload,
  type MatchMember,
  type Result,
  type RoomStage,
} from '../../../shared-kernel/index.ts';
import { GameName, type GameDifficulty } from './game-name.ts';
import type { Observation } from './observation.ts';

/** The room expires when the host has not created the game this long after the room entered `awaiting_host` (INV-07). */
export const AWAITING_HOST_EXPIRY_MS = 3 * 60 * 1000;

/** A member of a room: the match's member and whether the member's agent confirmed the current run (INV-06). */
export type RoomMember = MatchMember & { readonly confirmed: boolean };

/** Stage change or assignment produced by the aggregate, with the events to write to the outbox. */
export interface RoomChange {
  readonly room: LobbyRoom;
  readonly events: readonly AnyDomainEvent[];
}

export type ObservationOutcome =
  { readonly outcome: 'ignored' } | ({ readonly outcome: 'created' | 'confirmed' | 'active' } & RoomChange);

/** Why a member's request to the room is refused. */
export type RoomRefusal = 'not-member' | 'not-host' | 'wrong-stage';

/** Stored state of a room, as `LobbyRoom.restore` takes it. The host is named explicitly and checked against the members. */
export interface RestoredRoomProps {
  readonly id: string;
  readonly matchId: string;
  readonly mode: 'pvp' | 'leveling';
  readonly activity: string;
  readonly difficulty: GameDifficulty;
  readonly hostAccountId: string;
  readonly stage: RoomStage;
  readonly currentRun: number;
  readonly gameName: GameName;
  readonly members: readonly MatchMember[];
  /** When the room entered `awaiting_host` for the current run: required in that stage, ignored in the others. */
  readonly awaitingSince?: Date | null;
}

export interface LobbyRoomProps {
  readonly id: string;
  readonly matchId: string;
  readonly mode: 'pvp' | 'leveling';
  readonly activity: string;
  readonly difficulty: GameDifficulty;
  readonly stage: RoomStage;
  readonly currentRun: number;
  readonly gameName: GameName;
  readonly members: readonly RoomMember[];
  readonly awaitingSince: Date | null;
}

function isTerminal(stage: RoomStage): boolean {
  return stage === 'closed' || stage === 'expired';
}

/**
 * A room the host creates in the game and the agents confirm (INV-06, INV-08), through the stages `formed`,
 * `awaiting_host`, `created`, `active`, `expired` and `closed`. The password is always empty. Every transition returns
 * the events to write; the aggregate reads no clock (`now` arrives as a parameter).
 */
export class LobbyRoom {
  readonly id: string;
  readonly matchId: string;
  readonly mode: 'pvp' | 'leveling';
  readonly activity: string;
  readonly difficulty: GameDifficulty;
  readonly stage: RoomStage;
  readonly currentRun: number;
  readonly gameName: GameName;
  readonly members: readonly RoomMember[];
  /** When the room entered `awaiting_host` for the current run; null in every other stage. */
  readonly awaitingSince: Date | null;
  readonly password = '' as const;

  private constructor(props: LobbyRoomProps) {
    this.id = props.id;
    this.matchId = props.matchId;
    this.mode = props.mode;
    this.activity = props.activity;
    this.difficulty = props.difficulty;
    this.stage = props.stage;
    this.currentRun = props.currentRun;
    this.gameName = props.gameName;
    this.members = props.members;
    this.awaitingSince = props.awaitingSince;
  }

  /** The account of the host: the member the room names as host (the lowest join order when none is named). */
  get hostAccountId(): string {
    const host = this.members.find((member) => member.role === 'host') ?? this.members[0];
    if (host === undefined) {
      throw new Error('a lobby room always has a member');
    }
    return host.accountId;
  }

  /** The instant the room expires if the host has not created the game, or null when it is not `awaiting_host`. */
  get expiresAt(): Date | null {
    return this.stage === 'awaiting_host' && this.awaitingSince !== null
      ? new Date(this.awaitingSince.getTime() + AWAITING_HOST_EXPIRY_MS)
      : null;
  }

  /**
   * Opens the room for a match in stage `formed`, run 1. The match names its host (the teleporter of a leveling
   * group, the oldest ticket otherwise, queues QUE-12); a match that names none takes the lowest join order as host.
   * Emits `RoomAssignmentChanged` and `RoomStageChanged` (AD-039).
   */
  static fromMatch(
    match: MatchFormedPayload,
    n: number,
    ids: IdGenerator,
  ): Result<RoomChange, 'unsupported-difficulty'> {
    const gameName = GameName.of(match.activity, match.difficulty, n);
    if (!gameName.ok) {
      return err('unsupported-difficulty');
    }
    const ordered = [...match.members].sort((a, b) => a.joinOrder - b.joinOrder);
    const named = ordered.findIndex((member) => member.role === 'host');
    const hostIndex = named === -1 ? 0 : named;
    const assigned = ordered.map((member, index) => ({
      ...member,
      role: index === hostIndex ? ('host' as const) : ('member' as const),
    }));
    const room = new LobbyRoom({
      id: ids.next(),
      matchId: match.matchId,
      mode: match.mode,
      activity: match.activity,
      difficulty: match.difficulty,
      stage: 'formed',
      currentRun: 1,
      gameName: gameName.value,
      members: assigned.map((member) => ({ ...member, confirmed: false })),
      awaitingSince: null,
    });
    return ok({
      room,
      events: [
        {
          type: 'RoomAssignmentChanged',
          payload: { roomId: room.id, run: 1, expectedGameName: room.gameName.value, members: assigned },
        },
        { type: 'RoomStageChanged', payload: { roomId: room.id, stage: 'formed', members: room.members } },
      ],
    });
  }

  /**
   * Rebuilds a room from stored state (the Postgres repository's read path). Raises no event: the stored room already
   * had its events. Refuses state that breaks the aggregate's invariants: a run below 1, an `awaiting_host` room
   * without its start, members with a repeated account, and a host that is not the one member with role `host`
   * (every other member has role `member`).
   */
  static restore(props: RestoredRoomProps): Result<LobbyRoom, 'invalid-room'> {
    if (!Number.isInteger(props.currentRun) || props.currentRun < 1) {
      return err('invalid-room');
    }
    const awaitingSince = props.awaitingSince ?? null;
    if (props.stage === 'awaiting_host' && awaitingSince === null) {
      return err('invalid-room');
    }
    const members = [...props.members].sort((a, b) => a.joinOrder - b.joinOrder);
    // The host is the one member the match named (queues QUE-12), whatever its join order; every other member is a member.
    const hosts = members.filter((member) => member.role === 'host');
    const host = hosts[0];
    if (hosts.length !== 1 || host === undefined || host.accountId !== props.hostAccountId) {
      return err('invalid-room');
    }
    if (members.some((member) => member !== host && member.role !== 'member')) {
      return err('invalid-room');
    }
    if (new Set(members.map((member) => member.accountId)).size !== members.length) {
      return err('invalid-room');
    }
    return ok(
      new LobbyRoom({
        id: props.id,
        matchId: props.matchId,
        mode: props.mode,
        activity: props.activity,
        difficulty: props.difficulty,
        stage: props.stage,
        currentRun: props.currentRun,
        gameName: props.gameName,
        members: members.map((member) => ({ ...member, confirmed: member.confirmed ?? false })),
        awaitingSince: props.stage === 'awaiting_host' ? awaitingSince : null,
      }),
    );
  }

  /**
   * The host's agent has fetched or received the assignment: `formed` becomes `awaiting_host`, and the 3 minutes of
   * INV-07 start at `now` (LBR-02). Any other account, any other stage and a repeat change nothing (null).
   */
  markAssignmentDelivered(accountId: string, now: Date): RoomChange | null {
    if (this.stage !== 'formed' || accountId !== this.hostAccountId) {
      return null;
    }
    return this.#stageChange({ stage: 'awaiting_host', awaitingSince: now });
  }

  /**
   * Applies a `GAME_NAME_SEEN` of this room for the current run with the expected game name (ignoring case); every
   * other observation is ignored (INV-06, INV-09):
   * - from the host while `formed` or `awaiting_host`: the room is `created` and the host is confirmed (a host who
   *   reads the name has the assignment, so `formed` needs no separate delivery);
   * - from another member while `created`: that member is confirmed, and the room is `active` once every member is.
   */
  observe(observation: Observation): ObservationOutcome {
    const matches =
      observation.roomId === this.id &&
      observation.type === 'GAME_NAME_SEEN' &&
      observation.run === this.currentRun &&
      this.gameName.matches(observation.value);
    if (!matches) {
      return { outcome: 'ignored' };
    }
    const isHost = observation.accountId === this.hostAccountId;
    if (isHost && (this.stage === 'formed' || this.stage === 'awaiting_host')) {
      const change = this.#stageChange({
        stage: 'created',
        awaitingSince: null,
        confirm: observation.accountId,
      });
      return { outcome: 'created', ...change };
    }
    if (this.stage !== 'created' || isHost) {
      // The host was confirmed when the room was created: a repeat sighting of the host changes nothing.
      return { outcome: 'ignored' };
    }
    const member = this.members.find((candidate) => candidate.accountId === observation.accountId);
    if (member === undefined || member.confirmed) {
      return { outcome: 'ignored' };
    }
    const confirmed = this.#with({
      members: this.members.map((candidate) =>
        candidate === member ? { ...candidate, confirmed: true } : candidate,
      ),
    });
    const memberEvent = confirmed.#memberEvent('confirmed', member.accountId);
    if (!confirmed.members.every((candidate) => candidate.confirmed)) {
      return { outcome: 'confirmed', room: confirmed, events: [memberEvent] };
    }
    const active = confirmed.#with({ stage: 'active' });
    return { outcome: 'active', room: active, events: [memberEvent, active.#stageEvent()] };
  }

  /** Expires a room that is still `awaiting_host` once 3:00.000 have passed since it entered that stage (LBR-05). */
  expireIfDue(now: Date): RoomChange | null {
    const due = this.expiresAt;
    if (due === null || now.getTime() < due.getTime()) {
      return null;
    }
    return this.#stageChange({ stage: 'expired', awaitingSince: null });
  }

  /**
   * The host opens the next run of an `active` room with `nextName`: run n + 1, confirmations cleared, back to
   * `awaiting_host` with the 3 minutes starting at `now` (LBR-06).
   */
  openNextRun(by: string, nextName: GameName, now: Date): Result<RoomChange, RoomRefusal> {
    const refusal = this.#refusal(by, { host: true });
    if (refusal !== null) {
      return err(refusal);
    }
    if (this.stage !== 'active') {
      return err('wrong-stage');
    }
    const room = this.#with({
      stage: 'awaiting_host',
      currentRun: this.currentRun + 1,
      gameName: nextName,
      awaitingSince: now,
      members: this.members.map((member) => ({ ...member, confirmed: false })),
    });
    return ok({
      room,
      events: [
        {
          type: 'RoomRunOpened',
          payload: {
            roomId: room.id,
            run: room.currentRun,
            expectedGameName: room.gameName.value,
            members: room.members,
          },
        },
        room.#stageEvent(),
      ],
    });
  }

  /**
   * A member leaves. The host role passes to the remaining member with the lowest join order (LBR-07); the last
   * member to leave closes the room and stays listed as its member. A room that is `created` becomes `active` when the
   * members left are all confirmed.
   */
  leave(accountId: string): Result<RoomChange, RoomRefusal> {
    const refusal = this.#refusal(accountId, { host: false });
    if (refusal !== null) {
      return err(refusal);
    }
    const remaining = this.members.filter((member) => member.accountId !== accountId);
    if (remaining.length === 0) {
      const closed = this.#with({ stage: 'closed', awaitingSince: null });
      return ok({
        room: closed,
        events: [closed.#memberEvent('left', accountId), closed.#stageEvent()],
      });
    }
    const wasHost = accountId === this.hostAccountId;
    const successor = wasHost ? remaining[0] : undefined;
    let room = this.#with({
      members: remaining.map((member) =>
        successor !== undefined && member.accountId === successor.accountId
          ? { ...member, role: 'host' as const }
          : member,
      ),
    });
    const events: AnyDomainEvent[] = [room.#memberEvent('left', accountId)];
    if (successor !== undefined) {
      events.push(room.#memberEvent('host_changed', successor.accountId));
    }
    if (room.stage === 'created' && room.members.every((member) => member.confirmed)) {
      room = room.#with({ stage: 'active' });
      events.push(room.#stageEvent());
    }
    return ok({ room, events });
  }

  /** The host closes the room; every member is released (LBR-09). */
  close(by: string): Result<RoomChange, RoomRefusal> {
    const refusal = this.#refusal(by, { host: true });
    if (refusal !== null) {
      return err(refusal);
    }
    return ok(this.#stageChange({ stage: 'closed', awaitingSince: null }));
  }

  /** Refuses an account that is no member, a non-host where the host is required, and a room that is over. */
  #refusal(accountId: string, need: { readonly host: boolean }): RoomRefusal | null {
    if (!this.members.some((member) => member.accountId === accountId)) {
      return 'not-member';
    }
    if (need.host && accountId !== this.hostAccountId) {
      return 'not-host';
    }
    return isTerminal(this.stage) ? 'wrong-stage' : null;
  }

  #stageEvent(): AnyDomainEvent {
    return {
      type: 'RoomStageChanged',
      payload: { roomId: this.id, stage: this.stage, members: this.members },
    };
  }

  #memberEvent(change: 'confirmed' | 'left' | 'host_changed', accountId: string): AnyDomainEvent {
    return {
      type: 'RoomMemberChanged',
      payload: { roomId: this.id, change, accountId, members: this.members },
    };
  }

  #stageChange(next: {
    readonly stage: RoomStage;
    readonly awaitingSince: Date | null;
    readonly confirm?: string;
  }): RoomChange {
    const room = this.#with({
      stage: next.stage,
      awaitingSince: next.awaitingSince,
      members:
        next.confirm === undefined
          ? this.members
          : this.members.map((member) =>
              member.accountId === next.confirm ? { ...member, confirmed: true } : member,
            ),
    });
    return { room, events: [room.#stageEvent()] };
  }

  #with(changes: Partial<LobbyRoomProps>): LobbyRoom {
    return new LobbyRoom({
      id: this.id,
      matchId: this.matchId,
      mode: this.mode,
      activity: this.activity,
      difficulty: this.difficulty,
      stage: this.stage,
      currentRun: this.currentRun,
      gameName: this.gameName,
      members: this.members,
      awaitingSince: this.awaitingSince,
      ...changes,
    });
  }
}
