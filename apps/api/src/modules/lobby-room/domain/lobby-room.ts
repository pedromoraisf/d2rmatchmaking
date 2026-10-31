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

/** Stage change or assignment produced by the aggregate, with the events to write to the outbox. */
export interface RoomChange {
  readonly room: LobbyRoom;
  readonly events: readonly AnyDomainEvent[];
}

export type ObservationOutcome =
  { readonly outcome: 'ignored' } | ({ readonly outcome: 'created' } & RoomChange);

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
  readonly members: readonly MatchMember[];
}

/**
 * A room the host creates in the game and the agents confirm (INV-06, INV-08). The host is the member with the lowest
 * join order. The password is always empty.
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
  readonly members: readonly MatchMember[];
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
  }

  /** The account of the host: the member with the lowest join order. */
  get hostAccountId(): string {
    const host = this.members[0];
    if (host === undefined) {
      throw new Error('a lobby room always has a member');
    }
    return host.accountId;
  }

  /**
   * Opens the room for a match in stage `awaiting_host`, run 1. Roles follow the join order: the lowest join order is
   * the host. Emits `RoomAssignmentChanged` and `RoomStageChanged` (AD-039).
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
    const members = [...match.members]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((member, index) => ({ ...member, role: index === 0 ? ('host' as const) : ('member' as const) }));
    const room = new LobbyRoom({
      id: ids.next(),
      matchId: match.matchId,
      mode: match.mode,
      activity: match.activity,
      difficulty: match.difficulty,
      stage: 'awaiting_host',
      currentRun: 1,
      gameName: gameName.value,
      members,
    });
    return ok({
      room,
      events: [
        {
          type: 'RoomAssignmentChanged',
          payload: { roomId: room.id, run: 1, expectedGameName: room.gameName.value, members },
        },
        { type: 'RoomStageChanged', payload: { roomId: room.id, stage: 'awaiting_host', members } },
      ],
    });
  }

  /**
   * Rebuilds a room from stored state (the Postgres repository's read path). Raises no event: the stored room already
   * had its events. Refuses state that breaks the aggregate's invariants: a stage other than `awaiting_host` or
   * `created`, a run below 1, members with a repeated account, and a host that is not the lowest join order member
   * with role `host` (every other member has role `member`).
   */
  static restore(props: RestoredRoomProps): Result<LobbyRoom, 'invalid-room'> {
    if (props.stage !== 'awaiting_host' && props.stage !== 'created') {
      return err('invalid-room');
    }
    if (!Number.isInteger(props.currentRun) || props.currentRun < 1) {
      return err('invalid-room');
    }
    const members = [...props.members].sort((a, b) => a.joinOrder - b.joinOrder);
    const host = members[0];
    if (host === undefined || host.role !== 'host' || host.accountId !== props.hostAccountId) {
      return err('invalid-room');
    }
    if (members.slice(1).some((member) => member.role !== 'member')) {
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
        members,
      }),
    );
  }

  /**
   * Moves `awaiting_host` to `created` only for a `GAME_NAME_SEEN` of this room, from the host's account, for the
   * current run, with the expected game name ignoring case. Every other observation, and every observation once the
   * room is created, is ignored (INV-06, INV-09).
   */
  observe(observation: Observation): ObservationOutcome {
    const matches =
      this.stage === 'awaiting_host' &&
      observation.roomId === this.id &&
      observation.type === 'GAME_NAME_SEEN' &&
      observation.accountId === this.hostAccountId &&
      observation.run === this.currentRun &&
      this.gameName.matches(observation.value);
    if (!matches) {
      return { outcome: 'ignored' };
    }
    const room = this.#withStage('created');
    return {
      outcome: 'created',
      room,
      events: [
        { type: 'RoomStageChanged', payload: { roomId: room.id, stage: 'created', members: room.members } },
      ],
    };
  }

  #withStage(stage: RoomStage): LobbyRoom {
    return new LobbyRoom({
      id: this.id,
      matchId: this.matchId,
      mode: this.mode,
      activity: this.activity,
      difficulty: this.difficulty,
      stage,
      currentRun: this.currentRun,
      gameName: this.gameName,
      members: this.members,
    });
  }
}
