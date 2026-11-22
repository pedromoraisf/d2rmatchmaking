// What the lobby room's use cases do besides answering: the metrics and span attributes they report, the guards that spare
// a lock and a read, the order of the actions on one room and the team marks of a 2v2 (LBR-02, LBR-05, LBR-06, LBR-08,
// LBR-13, QUE-12). Fakes for every port; a few of them are subclassed here to count what the use cases ask of them.
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import type { LobbyRoom } from '../domain/lobby-room.ts';
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
const SECOND = 1000;
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

function spanNamed(name: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find((finished) => finished.name === name);
  if (span === undefined) {
    throw new Error(`no finished span named ${name}`);
  }
  return span;
}

function match(overrides: Partial<MatchFormedPayload> = {}): MatchFormedPayload {
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
    ...overrides,
  };
}

function seen(value: string, key: string): ObservationBody {
  return { idempotencyKey: key, type: 'GAME_NAME_SEEN', run: 1, value, confidence: 0.9, capturedAt: T0 };
}

/** The room repository, counting its reads and able to answer from a stale list or a room that is not the account's. */
class CountingRooms extends InMemoryLobbyRoomRepository {
  findByIdCalls = 0;
  staleOpen: LobbyRoom[] | null = null;
  newestOverride: LobbyRoom | null = null;
  /** When set, the next `findById` waits for it (the third caller of a room's lock must not overtake it). */
  gate: Promise<void> | null = null;
  /** Called when a read starts waiting on `gate`, so a test needs no guess about how many awaits come before it. */
  onGated: (() => void) | null = null;

  override async findById(roomId: string): Promise<LobbyRoom | null> {
    this.findByIdCalls += 1;
    const gate = this.gate;
    if (gate !== null && this.findByIdCalls === 2) {
      this.onGated?.();
      await gate;
    }
    return super.findById(roomId);
  }

  override async findOpen(): Promise<LobbyRoom[]> {
    return this.staleOpen ?? super.findOpen();
  }

  override async findNewestByAccount(accountId: string): Promise<LobbyRoom | null> {
    return this.newestOverride ?? super.findNewestByAccount(accountId);
  }
}

/** The connectivity of the members, counting how often an agent's absence was read. */
class CountingConnectivity extends FakeMemberConnectivity {
  agentReads = 0;

  override async agentOfflineSince(accountId: string): Promise<Date | null> {
    this.agentReads += 1;
    return super.agentOfflineSince(accountId);
  }
}

function setup() {
  const clock = new FakeClock(T0);
  const rooms = new CountingRooms(clock);
  const agents = new FakeAgentsPort();
  const outbox = new RecordingOutbox();
  const roomMetrics = new FakeRoomMetrics();
  const connectivity = new CountingConnectivity();
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
    characters: new FakeRoomCharacters(),
    dropToleranceMs: 60_000,
  });
  for (const order of [1, 2, 3, 9]) {
    agents.pair(`agent-${order}`, `account-${order}`);
  }
  return { useCases, rooms, outbox, clock, roomMetrics, connectivity };
}

type World = ReturnType<typeof setup>;

async function opened(payload: MatchFormedPayload = match()): Promise<World> {
  const world = setup();
  await world.useCases.onMatchFormed(payload);
  return world;
}

async function sight(world: World, order: number): Promise<void> {
  await world.useCases.recordObservation({
    agentId: `agent-${order}`,
    roomId: 'room-1',
    body: seen('mmbaalh-1', `key-${order}`),
  });
}

/** The host created the game 30 seconds after the room opened; the others joined 60 seconds after that. */
async function active(): Promise<World> {
  const world = await opened();
  await world.useCases.getAssignment({ agentId: 'agent-1' });
  world.clock.advance(30 * SECOND);
  await sight(world, 1);
  world.clock.advance(60 * SECOND + 500);
  await sight(world, 2);
  await sight(world, 3);
  return world;
}

async function room(world: World): Promise<LobbyRoom> {
  const found = await world.rooms.findById('room-1');
  if (found === null) {
    throw new Error('room-1 is not stored');
  }
  return found;
}

describe('the team marks of a 2v2 room (QUE-12)', () => {
  const duo = (): MatchFormedPayload =>
    match({
      mode: 'pvp',
      activity: 'pvp',
      members: [
        { accountId: 'account-1', characterId: 'char-1', joinOrder: 1, role: 'host', team: 'a' },
        { accountId: 'account-2', characterId: 'char-2', joinOrder: 2, role: 'member', team: 'b' },
      ],
    });

  it('gives the agent each member with the team they play on', async () => {
    const world = await opened(duo());

    const assignment = await world.useCases.getAssignment({ agentId: 'agent-1' });

    expect(assignment?.members).toStrictEqual([
      { accountId: 'account-1', characterId: 'char-1', joinOrder: 1, role: 'host', team: 'a' },
      { accountId: 'account-2', characterId: 'char-2', joinOrder: 2, role: 'member', team: 'b' },
    ]);
  });

  it('gives the site the same marks, and no team key to a group without teams', async () => {
    const pvp = await opened(duo());
    const snapshot = await pvp.useCases.getCurrentRoom({ accountId: 'account-1' });
    expect(snapshot?.members.map((member) => member.team)).toStrictEqual(['a', 'b']);

    const leveling = await opened();
    const levelingAssignment = await leveling.useCases.getAssignment({ agentId: 'agent-1' });
    for (const member of levelingAssignment?.members ?? []) {
      expect(Object.keys(member)).toStrictEqual(['accountId', 'characterId', 'joinOrder', 'role']);
    }
  });
});

describe('the actions of one room run one after the other (LBR-06, LBR-07)', () => {
  it('does not start a third action while the second still runs, even once the first is done', async () => {
    const world = await opened();
    let release: () => void = () => undefined;
    world.rooms.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const gated = new Promise<void>((resolve) => {
      world.rooms.onGated = resolve;
    });

    const first = world.useCases.leaveRoom({ accountId: 'account-3', roomId: 'room-1' });
    const second = world.useCases.leaveRoom({ accountId: 'account-2', roomId: 'room-1' });
    // The second action now holds the room, waiting on its read (the first is done); a later action must queue behind it.
    await gated;
    expect((await first).ok).toBe(true);
    const third = world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' });
    // A macrotask turn runs every pending microtask, however many awaits a use case makes before its read.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(world.rooms.findByIdCalls).toBe(2);

    release();
    expect((await second).ok).toBe(true);
    expect((await third).ok).toBe(true);
    expect(world.rooms.findByIdCalls).toBe(3);
    expect((await room(world)).stage).toBe('closed');
  });
});

describe('the room metrics (LBR-13)', () => {
  it('reports the exact seconds from opening to the first active', async () => {
    const world = await active();

    expect(world.roomMetrics.actives).toStrictEqual([
      { difficulty: 'hell', mode: 'leveling', seconds: 90.5 },
    ]);
  });

  it('reports the time spent before the host created the game, once, and nothing for a later confirmation', async () => {
    const world = await opened();
    await world.useCases.getAssignment({ agentId: 'agent-1' });
    world.clock.advance(30 * SECOND);
    await sight(world, 1);

    expect(world.roomMetrics.calls).toStrictEqual([
      { stage: 'awaiting_host', difficulty: 'hell', mode: 'leveling', seconds: 30 },
    ]);

    world.clock.advance(SECOND);
    await sight(world, 2);
    expect(await room(world).then((found) => found.stage)).toBe('created');
    await sight(world, 3);
    expect(await room(world).then((found) => found.stage)).toBe('active');
    expect(world.roomMetrics.calls).toHaveLength(1);
  });

  it('does not report the time to active again when a member leaves an active room', async () => {
    const world = await active();

    await world.useCases.leaveRoom({ accountId: 'account-3', roomId: 'room-1' });

    expect(world.roomMetrics.actives).toHaveLength(1);
    expect(world.roomMetrics.finals).toStrictEqual([]);
  });

  it('reports the final stage of a closed room and no time to active', async () => {
    const world = await opened();
    await world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' });

    expect(world.roomMetrics.finals).toStrictEqual([
      { stage: 'closed', difficulty: 'hell', mode: 'leveling' },
    ]);
    expect(world.roomMetrics.actives).toStrictEqual([]);
  });

  it('reports the final stage of an expired room and no time to active', async () => {
    const world = await opened();
    world.clock.advance(3 * 60 * SECOND);
    expect(await world.useCases.expireRooms()).toBe(1);

    expect(world.roomMetrics.finals).toStrictEqual([
      { stage: 'expired', difficulty: 'hell', mode: 'leveling' },
    ]);
    expect(world.roomMetrics.actives).toStrictEqual([]);
  });

  it('reports no time to active for the first active of a later run', async () => {
    const world = await active();
    await world.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-1' });
    expect((await room(world)).currentRun).toBe(2);
    world.roomMetrics.actives.length = 0;
    for (const order of [1, 2, 3]) {
      await world.useCases.recordObservation({
        agentId: `agent-${order}`,
        roomId: 'room-1',
        body: { ...seen('mmbaalh-2', `run2-${order}`), run: 2 },
      });
    }

    expect(world.roomMetrics.actives).toStrictEqual([]);
  });
});

describe('what the sweeps spare (LBR-05, LBR-08)', () => {
  it('reads and locks only the rooms that are due to expire', async () => {
    const world = await opened();
    world.rooms.findByIdCalls = 0;

    expect(await world.useCases.expireRooms()).toBe(0);
    expect(world.rooms.findByIdCalls).toBe(0);

    world.clock.advance(3 * 60 * SECOND);
    expect(await world.useCases.expireRooms()).toBe(1);
    expect(world.rooms.findByIdCalls).toBe(1);
  });

  it('asks nothing of the members of a room that closed after the sweep listed it', async () => {
    const world = await opened();
    world.rooms.staleOpen = await world.rooms.findOpen();
    await world.useCases.closeRoom({ accountId: 'account-1', roomId: 'room-1' });
    for (const order of [1, 2, 3]) {
      world.connectivity.setAgentOffline(`account-${order}`, new Date(T0.getTime() - 3600 * SECOND));
    }

    expect(await world.useCases.dropAbsentMembers()).toBe(0);
    expect(world.connectivity.agentReads).toBe(0);
  });

  it('asks nothing of the members of a room that expired after the sweep listed it', async () => {
    const world = await opened();
    world.rooms.staleOpen = await world.rooms.findOpen();
    world.clock.advance(3 * 60 * SECOND);
    await world.useCases.expireRooms();
    for (const order of [1, 2, 3]) {
      world.connectivity.setAgentOffline(`account-${order}`, new Date(T0.getTime() - 3600 * SECOND));
    }

    expect(await world.useCases.dropAbsentMembers()).toBe(0);
    expect(world.connectivity.agentReads).toBe(0);
  });
});

describe('the assignment fetch (LBR-02)', () => {
  it('locks and re-reads the room only for the host of a room that is still formed', async () => {
    const world = await opened();
    world.rooms.findByIdCalls = 0;

    await world.useCases.getAssignment({ agentId: 'agent-2' });
    expect(world.rooms.findByIdCalls).toBe(0);

    await world.useCases.getAssignment({ agentId: 'agent-1' });
    expect(world.rooms.findByIdCalls).toBe(1);

    await world.useCases.getAssignment({ agentId: 'agent-1' });
    await world.useCases.getAssignment({ agentId: 'agent-2' });
    expect(world.rooms.findByIdCalls).toBe(1);
  });
});

describe('has an open room (INV-04, QUE-06)', () => {
  it('opens its own span and is false for an account that is not a member of the room it is handed', async () => {
    const world = await opened();
    world.rooms.newestOverride = await room(world);

    expect(await world.useCases.hasOpenRoom('account-3')).toBe(true);
    expect(await world.useCases.hasOpenRoom('account-9')).toBe(false);
    expect(spanNamed('lobby.has-open-room')).toBeDefined();
  });
});

describe('the spans of the use cases (LBR-13)', () => {
  it('the match span carries the mode and, once the room exists, its ids', async () => {
    await opened();

    const attributes = spanNamed('lobby.on-match-formed').attributes;
    expect(attributes['mode']).toBe('leveling');
    expect(attributes['d2r.room.id']).toBe('room-1');
    expect(attributes['d2r.room.run']).toBe(1);
  });

  it('a match with an unsupported difficulty leaves an event with the reason and the difficulty, and no room', async () => {
    const world = setup();
    const result = await world.useCases.onMatchFormed(
      match({ difficulty: 'purgatory' as unknown as MatchFormedPayload['difficulty'] }),
    );

    expect(result).toStrictEqual({ ok: false, error: 'unsupported-difficulty' });
    const event = spanNamed('lobby.on-match-formed').events.find(
      (entry) => entry.name === 'lobby.match-refused',
    );
    expect(event?.attributes).toStrictEqual({ reason: 'unsupported-difficulty', difficulty: 'purgatory' });
  });

  it('the delivery span exists and carries the room of a formed room', async () => {
    const world = await opened();
    await world.useCases.onAssignmentDelivered({ accountId: 'account-1' });

    expect(spanNamed('lobby.on-assignment-delivered').attributes['d2r.room.id']).toBe('room-1');
    expect((await room(world)).stage).toBe('awaiting_host');
  });

  it('the delivery of an account with no room does nothing and does not fail', async () => {
    const world = setup();

    await expect(world.useCases.onAssignmentDelivered({ accountId: 'account-9' })).resolves.toBeUndefined();
  });

  it('an observation refused for an unknown room still names that room on its span', async () => {
    const world = setup();
    const result = await world.useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-x',
      body: seen('mmbaalh-1', 'k'),
    });

    expect(result).toStrictEqual({ ok: false, error: 'forbidden' });
    expect(spanNamed('lobby.record-observation').attributes['d2r.room.id']).toBe('room-x');
  });

  it('an action refused for an unknown room still names that room on its span', async () => {
    const world = setup();

    expect(await world.useCases.leaveRoom({ accountId: 'account-1', roomId: 'room-x' })).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
    expect(spanNamed('lobby.leave-room').attributes['d2r.room.id']).toBe('room-x');
  });
});

describe('who may record an observation, and who may act on a room', () => {
  it('refuses an agent whose account is not in the room, and stores nothing', async () => {
    const world = await opened();
    const before = world.outbox.appended.length;

    const result = await world.useCases.recordObservation({
      agentId: 'agent-9',
      roomId: 'room-1',
      body: seen('mmbaalh-1', 'k'),
    });

    expect(result).toStrictEqual({ ok: false, error: 'forbidden' });
    expect(world.outbox.appended).toHaveLength(before);
  });

  it('answers not-found to an account that is not in the room, and leaves the room as it was', async () => {
    const world = await opened();

    expect(await world.useCases.closeRoom({ accountId: 'account-9', roomId: 'room-1' })).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
    expect((await room(world)).stage).toBe('formed');
  });

  it('answers forbidden to a member who is not the host, and conflict to a stage that does not allow it', async () => {
    const world = await opened();

    expect(await world.useCases.closeRoom({ accountId: 'account-2', roomId: 'room-1' })).toStrictEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await world.useCases.openNextRun({ accountId: 'account-1', roomId: 'room-1' })).toStrictEqual({
      ok: false,
      error: 'conflict',
    });
  });
});
