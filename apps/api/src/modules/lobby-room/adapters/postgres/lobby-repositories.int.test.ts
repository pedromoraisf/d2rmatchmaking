import { randomUUID } from 'node:crypto';
import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import {
  FakeClock,
  type IdGenerator,
  type MatchFormedPayload,
  type Transaction,
} from '../../../../shared-kernel/index.ts';
import { GameName } from '../../domain/game-name.ts';
import { LobbyRoom, type RoomChange } from '../../domain/lobby-room.ts';
import { Observation } from '../../domain/observation.ts';
import { PostgresGameNameSequence } from './postgres-game-name-sequence.ts';
import { PostgresLobbyRoomRepository } from './postgres-lobby-room-repository.ts';
import { PostgresObservationRepository } from './postgres-observation-repository.ts';
import { PostgresRoomTraceContexts } from './postgres-room-trace-contexts.ts';
import type { LobbyDatabase } from './schema.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

let database: MigratedTestDatabase<LobbyDatabase>;
let rooms: PostgresLobbyRoomRepository;
let observations: PostgresObservationRepository;
let sequence: PostgresGameNameSequence;
let traceContexts: PostgresRoomTraceContexts;

beforeAll(async () => {
  database = await createMigratedTestDatabase<LobbyDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('delete from lobby.observations');
  await database.pool.query('delete from lobby.runs');
  await database.pool.query('delete from lobby.members');
  await database.pool.query('delete from lobby.rooms');
  const clock = new FakeClock(NOW);
  rooms = new PostgresLobbyRoomRepository(database.db, clock);
  observations = new PostgresObservationRepository(database.db, clock);
  sequence = new PostgresGameNameSequence(database.db);
  traceContexts = new PostgresRoomTraceContexts(database.db);
});

/** Runs the work in a real transaction and hands it the opaque token, as the platform's unit of work does. */
async function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.db.transaction().execute((trx) => work(trx as unknown as Transaction));
}

const ids: IdGenerator = { next: () => randomUUID() };

/** A hell Baal match of two uuid accounts, the host being the lower join order (accounts are uuids in the schema). */
function match(matchId: string = randomUUID()): MatchFormedPayload {
  return {
    matchId,
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [
      { accountId: randomUUID(), characterId: null, joinOrder: 2, role: 'member' },
      { accountId: randomUUID(), characterId: null, joinOrder: 1, role: 'host' },
    ],
  };
}

function formed(payload: MatchFormedPayload, n: number): LobbyRoom {
  const result = LobbyRoom.fromMatch(payload, n, ids, NOW);
  if (!result.ok) {
    throw new Error('expected the room to open');
  }
  return result.value.room;
}

function observation(agentId: string, idempotencyKey: string): Observation {
  const result = Observation.of({
    agentId,
    idempotencyKey,
    roomId: randomUUID(),
    accountId: randomUUID(),
    type: 'GAME_NAME_SEEN',
    run: 1,
    value: 'mmbaalh-12',
    confidence: 0.9,
    capturedAt: NOW,
  });
  if (!result.ok) {
    throw new Error('expected a valid observation');
  }
  return result.value;
}

describe('Lobby Room Postgres adapters', () => {
  it('openedAt returns the instant the room opened', async () => {
    const room = formed(match(), 13);
    await inTransaction((tx) => rooms.insert(tx, room));

    expect(await rooms.openedAt(room.id)).toEqual(NOW);
    expect(await rooms.openedAt(randomUUID())).toBeUndefined();
  });

  it('a room round-trips with members and run 1', async () => {
    const room = formed(match(), 12);
    await inTransaction((tx) => rooms.insert(tx, room));

    const found = await rooms.findById(room.id);

    expect(found?.id).toBe(room.id);
    expect(found?.matchId).toBe(room.matchId);
    expect(found?.stage).toBe('formed');
    expect(found?.currentRun).toBe(1);
    expect(found?.gameName.value).toBe('mmbaalh-12');
    expect(found?.hostAccountId).toBe(room.hostAccountId);
    expect(found?.members).toEqual(room.members);
    expect((await rooms.findByMatchId(room.matchId))?.id).toBe(room.id);
    expect((await rooms.findNewestByAccount(room.hostAccountId))?.id).toBe(room.id);
  });

  it('a second room with the same match_id fails on the unique constraint', async () => {
    const payload = match();
    await inTransaction((tx) => rooms.insert(tx, formed(payload, 12)));

    const duplicate = inTransaction((tx) => rooms.insert(tx, formed(payload, 13)));

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });

  it('reads a room written without a traceparent as having none', async () => {
    const room = formed(match(), 14);
    await inTransaction((tx) => rooms.insert(tx, room));

    expect(await traceContexts.find(room.id)).toBeNull();
  });

  it("stores and reads a room's traceparent", async () => {
    const room = formed(match(), 15);
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    await inTransaction((tx) => rooms.insert(tx, room));

    await inTransaction((tx) => traceContexts.record(tx, room.id, traceparent));

    expect(await traceContexts.find(room.id)).toBe(traceparent);
  });

  it('two sequence values differ and increase', async () => {
    const first = await sequence.next();
    const second = await sequence.next();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it('the same idempotency key for two agents is stored twice, for one agent once', async () => {
    const agentA = randomUUID();
    const agentB = randomUUID();
    await inTransaction(async (tx) => {
      await observations.insert(tx, observation(agentA, 'shared-key'));
      await observations.insert(tx, observation(agentB, 'shared-key'));
    });

    const stored = await database.pool.query<{ count: string }>(
      `select count(*)::text as count from lobby.observations where idempotency_key = 'shared-key'`,
    );
    expect(stored.rows[0]?.count).toBe('2');
    expect(await observations.exists(agentA, 'shared-key')).toBe(true);
    expect(await observations.exists(agentB, 'shared-key')).toBe(true);
    expect(await observations.exists(randomUUID(), 'shared-key')).toBe(false);

    const again = inTransaction((tx) => observations.insert(tx, observation(agentA, 'shared-key')));
    await expect(again).rejects.toMatchObject({ code: '23505' });
  });
});

describe('the room stages in Postgres (lobby-rooms)', () => {
  const LATER = new Date('2026-10-31T12:05:00.000Z');

  /** A three-member room in `formed`; member 1 hosts. */
  function trio(): LobbyRoom {
    const payload = match();
    return formed(
      {
        ...payload,
        members: [
          ...payload.members,
          { accountId: randomUUID(), characterId: null, joinOrder: 3, role: 'member' as const },
        ],
      },
      21,
    );
  }

  function changed(change: RoomChange | null): LobbyRoom {
    if (change === null) {
      throw new Error('expected a change');
    }
    return change.room;
  }

  function seen(room: LobbyRoom, accountId: string): LobbyRoom {
    const made = Observation.of({
      agentId: randomUUID(),
      idempotencyKey: randomUUID(),
      roomId: room.id,
      accountId,
      type: 'GAME_NAME_SEEN',
      run: room.currentRun,
      value: room.gameName.value,
      confidence: 0.9,
      capturedAt: NOW,
    });
    if (!made.ok) {
      throw new Error('expected an observation');
    }
    const outcome = room.observe(made.value);
    if (outcome.outcome === 'ignored') {
      throw new Error('expected a change');
    }
    return outcome.room;
  }

  async function save(room: LobbyRoom): Promise<void> {
    await inTransaction((tx) => rooms.save(tx, room));
  }

  it('stores when the room entered awaiting_host and reads it back', async () => {
    const room = trio();
    await inTransaction((tx) => rooms.insert(tx, room));
    const waiting = changed(room.markAssignmentDelivered(room.hostAccountId, LATER));

    await save(waiting);

    const found = await rooms.findById(room.id);
    expect(found?.stage).toBe('awaiting_host');
    expect(found?.awaitingSince).toEqual(LATER);
    expect(found?.expiresAt).toEqual(new Date(LATER.getTime() + 180_000));
  });

  it('stores each confirmation for the current run and the stage that follows', async () => {
    const room = trio();
    await inTransaction((tx) => rooms.insert(tx, room));
    const [host, second, third] = room.members.map((member) => member.accountId) as [string, string, string];
    let current = changed(room.markAssignmentDelivered(host, NOW));
    current = seen(current, host);
    await save(current);
    expect((await rooms.findById(room.id))?.members.map((member) => member.confirmed)).toEqual([
      true,
      false,
      false,
    ]);

    current = seen(seen(current, second), third);
    await save(current);

    const found = await rooms.findById(room.id);
    expect(found?.stage).toBe('active');
    expect(found?.members.map((member) => member.confirmed)).toEqual([true, true, true]);
  });

  it('clears the confirmations and adds the run when the next run opens', async () => {
    const room = trio();
    await inTransaction((tx) => rooms.insert(tx, room));
    const [host, second, third] = room.members.map((member) => member.accountId) as [string, string, string];
    let current = seen(changed(room.markAssignmentDelivered(host, NOW)), host);
    current = seen(seen(current, second), third);
    await save(current);
    const name = GameName.of('baal', 'hell', 22);
    if (!name.ok) {
      throw new Error('expected a name');
    }
    const next = current.openNextRun(host, name.value, LATER);
    if (!next.ok) {
      throw new Error('expected a next run');
    }

    await save(next.value.room);

    const found = await rooms.findById(room.id);
    expect(found).toMatchObject({ stage: 'awaiting_host', currentRun: 2 });
    expect(found?.gameName.value).toBe('mmbaalh-22');
    expect(found?.members.every((member) => !member.confirmed)).toBe(true);
    expect(await rooms.runsOf(room.id)).toEqual([
      { run: 1, gameName: room.gameName.value },
      { run: 2, gameName: 'mmbaalh-22' },
    ]);
  });

  it('keeps a member who left out of the room, passes the host role on and skips the room for them', async () => {
    const room = trio();
    await inTransaction((tx) => rooms.insert(tx, room));
    const [host, second, third] = room.members.map((member) => member.accountId) as [string, string, string];
    const left = room.leave(host);
    if (!left.ok) {
      throw new Error('expected a leave');
    }

    await save(left.value.room);

    const found = await rooms.findById(room.id);
    expect(found?.members.map((member) => [member.accountId, member.role])).toEqual([
      [second, 'host'],
      [third, 'member'],
    ]);
    expect(found?.hostAccountId).toBe(second);
    expect(await rooms.findNewestByAccount(host)).toBeNull();
    expect((await rooms.findNewestByAccount(third))?.id).toBe(room.id);
    const row = await database.pool.query<{ left_at: Date | null }>(
      'select left_at from lobby.members where room_id = $1 and account_id = $2',
      [room.id, host],
    );
    expect(row.rows[0]?.left_at).toEqual(NOW);
  });

  it('reads a consistent room when the host leaves between its statements (LBR-07)', async () => {
    const room = trio();
    await inTransaction((tx) => rooms.insert(tx, room));
    const host = room.members[0]?.accountId as string;
    const left = room.leave(host);
    if (!left.ok) {
      throw new Error('expected a leave');
    }
    // Commits the leave right after the read of the room row, before the read of its members.
    let fired = false;
    const interleaving: KyselyPlugin = {
      transformQuery: (args) => args.node,
      transformResult: async (args) => {
        const first = (args.result.rows[0] ?? {}) as { host_account_id?: string };
        if (!fired && first.host_account_id === host) {
          fired = true;
          await save(left.value.room);
        }
        return args.result;
      },
    };
    const reader = new PostgresLobbyRoomRepository(database.db.withPlugin(interleaving), new FakeClock(NOW));

    const found = await reader.findById(room.id);

    expect(fired).toBe(true);
    expect(found?.members.map((member) => member.accountId)).toContain(found?.hostAccountId);
  });

  it('keeps the last member to leave listed in the closed room', async () => {
    const room = formed(
      { ...match(), members: [{ accountId: randomUUID(), characterId: null, joinOrder: 1, role: 'host' }] },
      23,
    );
    await inTransaction((tx) => rooms.insert(tx, room));
    const left = room.leave(room.hostAccountId);
    if (!left.ok) {
      throw new Error('expected a leave');
    }

    await save(left.value.room);

    const found = await rooms.findById(room.id);
    expect(found?.stage).toBe('closed');
    expect(found?.members).toHaveLength(1);
    expect((await rooms.findNewestByAccount(room.hostAccountId))?.id).toBe(room.id);
  });

  it('lists only the open rooms, and stamps when a room ended', async () => {
    const open = trio();
    const ended = formed(match(), 24);
    await inTransaction(async (tx) => {
      await rooms.insert(tx, open);
      await rooms.insert(tx, ended);
    });
    const closed = ended.close(ended.hostAccountId);
    if (!closed.ok) {
      throw new Error('expected a close');
    }
    await save(closed.value.room);

    expect((await rooms.findOpen()).map((room) => room.id)).toEqual([open.id]);
    const row = await database.pool.query<{ closed_at: Date | null }>(
      'select closed_at from lobby.rooms where id = $1',
      [ended.id],
    );
    expect(row.rows[0]?.closed_at).toEqual(NOW);
  });
});
