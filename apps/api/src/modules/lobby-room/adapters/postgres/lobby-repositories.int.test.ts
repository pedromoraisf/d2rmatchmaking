import { randomUUID } from 'node:crypto';
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
import { LobbyRoom } from '../../domain/lobby-room.ts';
import { Observation } from '../../domain/observation.ts';
import { PostgresGameNameSequence } from './postgres-game-name-sequence.ts';
import { PostgresLobbyRoomRepository } from './postgres-lobby-room-repository.ts';
import { PostgresObservationRepository } from './postgres-observation-repository.ts';
import type { LobbyDatabase } from './schema.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

let database: MigratedTestDatabase<LobbyDatabase>;
let rooms: PostgresLobbyRoomRepository;
let observations: PostgresObservationRepository;
let sequence: PostgresGameNameSequence;

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
  const result = LobbyRoom.fromMatch(payload, n, ids);
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
  it('a room round-trips with members and run 1', async () => {
    const room = formed(match(), 12);
    await inTransaction((tx) => rooms.insert(tx, room));

    const found = await rooms.findById(room.id);

    expect(found?.id).toBe(room.id);
    expect(found?.matchId).toBe(room.matchId);
    expect(found?.stage).toBe('awaiting_host');
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
