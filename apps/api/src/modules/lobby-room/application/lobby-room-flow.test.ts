import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import { createLobbyRoomUseCases, type ObservationBody } from './lobby-room-use-cases.ts';
import { FakeAgentsPort } from './testing/fake-agents-port.ts';
import { FakeRoomCharacters } from './testing/fake-room-characters.ts';
import { FakeRoomMetrics } from './testing/fake-room-metrics.ts';
import { InMemoryGameNameSequence } from './testing/in-memory-game-name-sequence.ts';
import { InMemoryLobbyRoomRepository } from './testing/in-memory-lobby-room-repository.ts';
import { FakeMemberConnectivity } from './testing/in-memory-member-connectivity.ts';
import { InMemoryObservationRepository } from './testing/in-memory-observation-repository.ts';
import { InMemoryRoomTraceContexts } from './testing/in-memory-room-trace-contexts.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

function match(): MatchFormedPayload {
  return {
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [1, 2, 3].map((order) => ({
      accountId: `account-${order}`,
      characterId: `char-${order}`,
      joinOrder: order,
      role: order === 1 ? ('host' as const) : ('member' as const),
    })),
  };
}

function setup() {
  const clock = new FakeClock(T0);
  const rooms = new InMemoryLobbyRoomRepository(clock);
  const agents = new FakeAgentsPort();
  const outbox = new RecordingOutbox();
  const roomMetrics = new FakeRoomMetrics();
  const connectivity = new FakeMemberConnectivity();
  const characters = new FakeRoomCharacters();
  const useCases = createLobbyRoomUseCases({
    rooms,
    observations: new InMemoryObservationRepository(),
    sequence: new InMemoryGameNameSequence(),
    agents,
    ids: new SequentialIdGenerator('room'),
    uow: new InMemoryUnitOfWork(),
    outbox,
    clock,
    roomMetrics,
    traceContexts: new InMemoryRoomTraceContexts(),
    connectivity,
    characters,
    dropToleranceMs: 60_000,
  });
  for (const order of [1, 2, 3]) {
    agents.pair(`agent-${order}`, `account-${order}`);
  }
  return { useCases, rooms, outbox, clock, roomMetrics, connectivity, characters };
}

function seen(run: number, value: string, key: string): ObservationBody {
  return {
    idempotencyKey: key,
    type: 'GAME_NAME_SEEN',
    run,
    value,
    confidence: 0.9,
    capturedAt: T0,
  };
}

type Setup = ReturnType<typeof setup>;

async function opened(): Promise<Setup> {
  const world = setup();
  await world.useCases.onMatchFormed(match());
  return world;
}

async function awaitingHost(): Promise<Setup> {
  const world = await opened();
  await world.useCases.getAssignment({ agentId: 'agent-1' });
  return world;
}

async function active(): Promise<Setup> {
  const world = await awaitingHost();
  for (const order of [1, 2, 3]) {
    await world.useCases.recordObservation({
      agentId: `agent-${order}`,
      roomId: 'room-1',
      body: seen(1, 'mmbaalh-1', `key-${order}`),
    });
  }
  return world;
}

async function stageOf(world: Setup, accountId = 'account-1') {
  return (await world.useCases.getCurrentRoom({ accountId }))?.stage;
}

describe('assignment delivery (LBR-02)', () => {
  it('opens formed and stays formed when a member who is not the host fetches the assignment', async () => {
    const world = await opened();

    await world.useCases.getAssignment({ agentId: 'agent-2' });

    expect(await stageOf(world)).toBe('formed');
  });

  it("moves to awaiting_host when the host's agent fetches the assignment, once", async () => {
    const world = await opened();

    await world.useCases.getAssignment({ agentId: 'agent-1' });
    await world.useCases.getAssignment({ agentId: 'agent-1' });

    expect(await stageOf(world)).toBe('awaiting_host');
    expect(world.outbox.appended.map((event) => event.type)).toEqual([
      'RoomAssignmentChanged',
      'RoomStageChanged',
      'RoomStageChanged',
    ]);
  });

  it('moves to awaiting_host when the assignment reaches the host on its stream', async () => {
    const world = await opened();

    await world.useCases.onAssignmentDelivered({ accountId: 'account-2' });
    expect(await stageOf(world)).toBe('formed');
    await world.useCases.onAssignmentDelivered({ accountId: 'account-1' });

    expect(await stageOf(world)).toBe('awaiting_host');
    const room = await world.useCases.getCurrentRoom({ accountId: 'account-1' });
    expect(room?.expiresAt).toBe('2026-11-01T10:03:00.000Z');
  });

  it('ignores a delivery for an account with no room', async () => {
    const world = await opened();

    await expect(world.useCases.onAssignmentDelivered({ accountId: 'account-9' })).resolves.toBeUndefined();
  });
});

describe('confirmation by the agents (LBR-03, LBR-04, LBR-11)', () => {
  it('creates the room on the host sighting, then activates it when every member is confirmed', async () => {
    const world = await awaitingHost();

    await world.useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: seen(1, 'mmbaalh-1', 'k1'),
    });
    expect(await stageOf(world)).toBe('created');
    await world.useCases.recordObservation({
      agentId: 'agent-2',
      roomId: 'room-1',
      body: seen(1, 'MMBAALH-1', 'k2'),
    });
    expect(await stageOf(world)).toBe('created');
    await world.useCases.recordObservation({
      agentId: 'agent-3',
      roomId: 'room-1',
      body: seen(1, 'mmbaalh-1', 'k3'),
    });

    expect(await stageOf(world)).toBe('active');
    const room = await world.useCases.getCurrentRoom({ accountId: 'account-2' });
    expect(room?.members.map((member) => member.confirmed)).toEqual([true, true, true]);
    expect(world.roomMetrics.actives).toHaveLength(1);
    expect(world.roomMetrics.actives[0]).toMatchObject({ difficulty: 'hell', mode: 'leveling' });
  });

  it('applies two sightings that arrive together one after the other', async () => {
    const world = await awaitingHost();
    await world.useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: seen(1, 'mmbaalh-1', 'k1'),
    });

    await Promise.all([
      world.useCases.recordObservation({
        agentId: 'agent-2',
        roomId: 'room-1',
        body: seen(1, 'mmbaalh-1', 'k2'),
      }),
      world.useCases.recordObservation({
        agentId: 'agent-3',
        roomId: 'room-1',
        body: seen(1, 'mmbaalh-1', 'k3'),
      }),
    ]);

    expect(await stageOf(world)).toBe('active');
  });
});

describe('expireRooms (LBR-05)', () => {
  it('expires a room 3 minutes after it waited for the host, not one millisecond before', async () => {
    const world = await awaitingHost();

    world.clock.advance(179_999);
    expect(await world.useCases.expireRooms()).toBe(0);
    expect(await stageOf(world)).toBe('awaiting_host');
    world.clock.advance(1);
    expect(await world.useCases.expireRooms()).toBe(1);

    expect(await stageOf(world)).toBe('expired');
    expect(await world.useCases.hasOpenRoom('account-2')).toBe(false);
    expect(world.roomMetrics.finals).toEqual([{ stage: 'expired', difficulty: 'hell', mode: 'leveling' }]);
    expect(await world.useCases.expireRooms()).toBe(0);
  });

  it('expires a room still formed 3 minutes after it opened and releases its members', async () => {
    const waiting = await opened();

    waiting.clock.advance(179_999);
    expect(await waiting.useCases.expireRooms()).toBe(0);
    expect(await stageOf(waiting)).toBe('formed');
    expect(await waiting.useCases.hasOpenRoom('account-2')).toBe(true);
    waiting.clock.advance(1);
    expect(await waiting.useCases.expireRooms()).toBe(1);

    expect(await stageOf(waiting)).toBe('expired');
    expect(await waiting.useCases.hasOpenRoom('account-1')).toBe(false);
    expect(await waiting.useCases.hasOpenRoom('account-2')).toBe(false);
    expect(waiting.roomMetrics.finals).toEqual([{ stage: 'expired', difficulty: 'hell', mode: 'leveling' }]);
  });

  it('does not expire a created room', async () => {
    const made = await awaitingHost();
    await made.useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: seen(1, 'mmbaalh-1', 'k1'),
    });
    made.clock.advance(3_600_000);
    expect(await made.useCases.expireRooms()).toBe(0);
    expect(await stageOf(made)).toBe('created');
  });
});

describe('openNextRun (LBR-06)', () => {
  it('opens run 2 with a new name for the host and tells the members', async () => {
    const world = await active();
    world.clock.advance(60_000);

    const result = await world.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-1' });

    expect(result).toEqual({ ok: true, value: true });
    const room = await world.useCases.getCurrentRoom({ accountId: 'account-2' });
    expect(room).toMatchObject({ stage: 'awaiting_host', run: 2, expectedGameName: 'mmbaalh-2' });
    expect(room?.runs).toEqual([
      { run: 1, gameName: 'mmbaalh-1' },
      { run: 2, gameName: 'mmbaalh-2' },
    ]);
    expect(room?.members.every((member) => !member.confirmed)).toBe(true);
    expect(room?.expiresAt).toBe('2026-11-01T10:04:00.000Z');
    expect(world.outbox.appended.map((event) => event.type).slice(-2)).toEqual([
      'RoomRunOpened',
      'RoomStageChanged',
    ]);
    const assignment = await world.useCases.getAssignment({ agentId: 'agent-2' });
    expect(assignment?.expectedGameName).toBe('mmbaalh-2');
  });

  it('refuses a member who is not the host (403), a stranger (404) and a room that is not active (409)', async () => {
    const world = await active();

    expect(await world.useCases.openNextRun({ accountId: 'account-2', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await world.useCases.openNextRun({ accountId: 'account-9', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await world.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-9' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    const waiting = await awaitingHost();
    expect(await waiting.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'conflict',
    });
  });
});

describe('leaveRoom and closeRoom (LBR-07, LBR-09)', () => {
  it('passes the host role on when the host leaves and frees the host', async () => {
    const world = await active();

    const result = await world.useCases.leaveRoom({ accountId: 'account-1', roomId: 'room-1' });

    expect(result).toEqual({ ok: true, value: true });
    const room = await world.useCases.getCurrentRoom({ accountId: 'account-3' });
    expect(room?.members.map((member) => [member.accountId, member.role])).toEqual([
      ['account-2', 'host'],
      ['account-3', 'member'],
    ]);
    expect(await world.useCases.hasOpenRoom('account-1')).toBe(false);
    expect(await world.useCases.getCurrentRoom({ accountId: 'account-1' })).toBeNull();
  });

  it('closes the room when the last member leaves', async () => {
    const world = await active();
    for (const order of [1, 2, 3]) {
      await world.useCases.leaveRoom({ accountId: `account-${order}`, roomId: 'room-1' });
    }

    expect(await stageOf(world, 'account-3')).toBe('closed');
    expect(world.roomMetrics.finals).toEqual([{ stage: 'closed', difficulty: 'hell', mode: 'leveling' }]);
    expect(await world.useCases.hasOpenRoom('account-3')).toBe(false);
  });

  it('lets only the host close the room, and releases every member', async () => {
    const world = await active();

    expect(await world.useCases.closeRoom({ accountId: 'account-2', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' })).toEqual({
      ok: true,
      value: true,
    });

    expect(await stageOf(world, 'account-2')).toBe('closed');
    expect(await world.useCases.hasOpenRoom('account-2')).toBe(false);
    expect(await world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'conflict',
    });
    expect(await world.useCases.leaveRoom({ accountId: 'account-2', roomId: 'room-1' })).toEqual({
      ok: false,
      error: 'conflict',
    });
  });
});

describe('dropAbsentMembers (LBR-08, FR-32)', () => {
  it('drops a member whose agent has been offline for the tolerance, not before', async () => {
    const world = await active();
    world.connectivity.setAgentOffline('account-2', new Date(T0.getTime() + 45_000));

    world.clock.advance(104_999);
    expect(await world.useCases.dropAbsentMembers()).toBe(0);
    world.clock.advance(1);
    expect(await world.useCases.dropAbsentMembers()).toBe(1);

    const room = await world.useCases.getCurrentRoom({ accountId: 'account-1' });
    expect(room?.members.map((member) => member.accountId)).toEqual(['account-1', 'account-3']);
    expect(await world.useCases.hasOpenRoom('account-2')).toBe(false);
    const last = world.outbox.appended.at(-1);
    expect(last).toMatchObject({
      type: 'RoomMemberChanged',
      payload: { change: 'left', accountId: 'account-2' },
    });
  });

  it('drops a member whose site stream has been closed for the tolerance, and passes the host role on', async () => {
    const world = await active();
    world.connectivity.setSiteClosed('account-1', T0);

    world.clock.advance(60_000);
    expect(await world.useCases.dropAbsentMembers()).toBe(1);

    const room = await world.useCases.getCurrentRoom({ accountId: 'account-2' });
    expect(room?.members.find((member) => member.role === 'host')?.accountId).toBe('account-2');
  });

  it('keeps a member who came back, and closes the room when everyone is gone', async () => {
    const world = await active();
    world.connectivity.setAgentOffline('account-2', T0);
    world.clock.advance(30_000);
    world.connectivity.setAgentOffline('account-2', null);
    world.clock.advance(60_000);
    expect(await world.useCases.dropAbsentMembers()).toBe(0);

    for (const order of [1, 2, 3]) {
      world.connectivity.setAgentOffline(`account-${order}`, T0);
    }
    expect(await world.useCases.dropAbsentMembers()).toBe(3);
    expect(await stageOf(world, 'account-3')).toBe('closed');
    expect(await world.useCases.dropAbsentMembers()).toBe(0);
  });
});

describe('the room panel snapshot (LBR-12)', () => {
  it("names the reader, the members' class and level, and the run history", async () => {
    const world = await awaitingHost();
    world.characters.add('account-2', 'char-2', 'sorceress', 88);

    const room = await world.useCases.getCurrentRoom({ accountId: 'account-2' });

    expect(room?.you).toBe('account-2');
    expect(room?.serverNow).toBe('2026-11-01T10:00:00.000Z');
    expect(room?.runs).toEqual([{ run: 1, gameName: 'mmbaalh-1' }]);
    expect(room?.members.map((member) => [member.class, member.level])).toEqual([
      [null, null],
      ['sorceress', 88],
      [null, null],
    ]);
  });
});

describe('telemetry (LBR-13)', () => {
  it('opens a span per use case with the room, run, difficulty and activity, and no name', async () => {
    const world = await active();
    exporter.reset();

    await world.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-1' });
    await world.useCases.leaveRoom({ accountId: 'account-2', roomId: 'room-1' });
    await world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' });
    await world.useCases.expireRooms();
    await world.useCases.dropAbsentMembers();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'lobby.open-next-run',
        'lobby.leave-room',
        'lobby.close-room',
        'lobby.expire-rooms',
        'lobby.drop-absent-members',
      ]),
    );
    const leave = spans.find((span) => span.name === 'lobby.leave-room');
    expect(leave?.attributes).toEqual({
      'd2r.room.id': 'room-1',
      'd2r.room.run': 2,
      'd2r.difficulty': 'hell',
      'd2r.room.activity': 'baal',
      'd2r.queue.mode': 'leveling',
    });
    for (const span of spans) {
      expect(Object.keys(span.attributes)).not.toContain('accountId');
    }
  });
});
