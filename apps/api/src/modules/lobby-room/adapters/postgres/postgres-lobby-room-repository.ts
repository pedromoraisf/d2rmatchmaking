import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Clock, MatchMember, Transaction } from '../../../../shared-kernel/index.ts';
import { GameName } from '../../domain/game-name.ts';
import { LobbyRoom } from '../../domain/lobby-room.ts';
import type { LobbyRoomRepository } from '../../application/ports.ts';
import { executorOf } from './executor.ts';
import type { LobbyDatabase } from './schema.ts';

type RoomRow = LobbyDatabase['lobby.rooms'];

/** The game name's number is its trailing digits (`mm{activity}{difficulty}-{n}`, ADR 017). */
function gameNumber(gameName: string): number {
  const match = /-(\d+)$/.exec(gameName);
  if (match === null) {
    throw new Error('a stored game name has no number');
  }
  return Number(match[1]);
}

/**
 * Kysely LobbyRoomRepository (rooms, members, runs). A room is written with its members and its current run; it is read
 * back through `LobbyRoom.restore`, so the aggregate's invariants are checked on every read.
 */
export class PostgresLobbyRoomRepository implements LobbyRoomRepository {
  readonly #db: Kysely<LobbyDatabase>;
  readonly #clock: Clock;

  constructor(db: Kysely<LobbyDatabase>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async insert(tx: Transaction, room: LobbyRoom): Promise<void> {
    const executor = executorOf(tx);
    const now = this.#clock.now();
    await executor
      .insertInto('lobby.rooms')
      .values({
        id: room.id,
        match_id: room.matchId,
        mode: room.mode,
        activity: room.activity,
        difficulty: room.difficulty,
        host_account_id: room.hostAccountId,
        stage: room.stage,
        current_run: room.currentRun,
        created_at: now,
      })
      .execute();
    await executor
      .insertInto('lobby.members')
      .values(room.members.map((member) => toMemberRow(room.id, member)))
      .execute();
    await this.#insertRun(tx, room, now);
  }

  async save(tx: Transaction, room: LobbyRoom): Promise<void> {
    await executorOf(tx)
      .updateTable('lobby.rooms')
      .set({ stage: room.stage, current_run: room.currentRun })
      .where('id', '=', room.id)
      .execute();
    await this.#insertRun(tx, room, this.#clock.now());
  }

  async findById(roomId: string): Promise<LobbyRoom | null> {
    const row = await this.#db
      .selectFrom('lobby.rooms')
      .selectAll()
      .where('id', '=', roomId)
      .executeTakeFirst();
    return row === undefined ? null : this.#load(row);
  }

  async findByMatchId(matchId: string): Promise<LobbyRoom | null> {
    const row = await this.#db
      .selectFrom('lobby.rooms')
      .selectAll()
      .where('match_id', '=', matchId)
      .executeTakeFirst();
    return row === undefined ? null : this.#load(row);
  }

  /** The room with the highest game name number among the rooms the account is a member of (AWS-25). */
  async findNewestByAccount(accountId: string): Promise<LobbyRoom | null> {
    const row = await this.#db
      .selectFrom('lobby.rooms as r')
      .innerJoin('lobby.members as m', 'm.room_id', 'r.id')
      .innerJoin('lobby.runs as u', (join) =>
        join.onRef('u.room_id', '=', 'r.id').onRef('u.number', '=', 'r.current_run'),
      )
      .select(['r.id'])
      .where('m.account_id', '=', accountId)
      .orderBy(sql`cast(substring(u.game_name from '[0-9]+$') as int)`, 'desc')
      .executeTakeFirst();
    return row === undefined ? null : this.findById(row.id);
  }

  async openedAt(roomId: string): Promise<Date | undefined> {
    const row = await this.#db
      .selectFrom('lobby.rooms')
      .select('created_at')
      .where('id', '=', roomId)
      .executeTakeFirst();
    return row?.created_at;
  }

  async #insertRun(tx: Transaction, room: LobbyRoom, openedAt: Date): Promise<void> {
    await executorOf(tx)
      .insertInto('lobby.runs')
      .values({
        room_id: room.id,
        number: room.currentRun,
        game_name: room.gameName.value,
        opened_at: openedAt,
      })
      .onConflict((conflict) => conflict.columns(['room_id', 'number']).doNothing())
      .execute();
  }

  async #load(row: RoomRow): Promise<LobbyRoom> {
    const members = await this.#db
      .selectFrom('lobby.members')
      .select(['account_id', 'character_id', 'role', 'join_order'])
      .where('room_id', '=', row.id)
      .execute();
    const run = await this.#db
      .selectFrom('lobby.runs')
      .select('game_name')
      .where('room_id', '=', row.id)
      .where('number', '=', row.current_run)
      .executeTakeFirst();
    if (run === undefined) {
      throw new Error('a stored room has no run for its current run number');
    }
    const gameName = GameName.of(row.activity, row.difficulty, gameNumber(run.game_name));
    if (!gameName.ok) {
      throw new Error('a stored room has an unsupported difficulty');
    }
    const restored = LobbyRoom.restore({
      id: row.id,
      matchId: row.match_id,
      mode: row.mode,
      activity: row.activity,
      difficulty: row.difficulty,
      hostAccountId: row.host_account_id,
      stage: row.stage,
      currentRun: row.current_run,
      gameName: gameName.value,
      members: members.map((member) => ({
        accountId: member.account_id,
        characterId: member.character_id,
        joinOrder: member.join_order,
        role: member.role,
      })),
    });
    if (!restored.ok) {
      throw new Error('a stored room breaks the aggregate invariants');
    }
    return restored.value;
  }
}

function toMemberRow(roomId: string, member: MatchMember) {
  return {
    room_id: roomId,
    account_id: member.accountId,
    character_id: member.characterId,
    role: member.role,
    join_order: member.joinOrder,
  };
}
