import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { D2R_ROOM_ID } from '@d2rmm/telemetry';
import {
  FakeClock,
  SequentialIdGenerator,
  withSpan,
  type MatchFormedPayload,
} from '../../../shared-kernel/index.ts';
import { createMatchmakingUseCases } from '../../matchmaking/index.ts';
import { createLobbyRoomUseCases, type ObservationBody } from './lobby-room-use-cases.ts';
import { FakeAgentsPort } from './testing/fake-agents-port.ts';
import { InMemoryGameNameSequence } from './testing/in-memory-game-name-sequence.ts';
import { FakeRoomMetrics } from './testing/fake-room-metrics.ts';
import { InMemoryLobbyRoomRepository } from './testing/in-memory-lobby-room-repository.ts';
import { InMemoryObservationRepository } from './testing/in-memory-observation-repository.ts';
import { InMemoryRoomTraceContexts } from './testing/in-memory-room-trace-contexts.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const CAPTURED_AT = new Date('2026-10-31T10:00:00.000Z');
const OPENED_AT = new Date('2026-10-31T09:55:00.000Z');

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  // A real context manager, so the span a use case makes active is the one `trace.getActiveSpan` returns.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
});

beforeEach(() => {
  exporter.reset();
});

function setup() {
  const clock = new FakeClock(OPENED_AT);
  const rooms = new InMemoryLobbyRoomRepository(clock);
  const observations = new InMemoryObservationRepository();
  const agents = new FakeAgentsPort();
  const outbox = new RecordingOutbox();
  const roomMetrics = new FakeRoomMetrics();
  const traceContexts = new InMemoryRoomTraceContexts();
  const useCases = createLobbyRoomUseCases({
    rooms,
    observations,
    sequence: new InMemoryGameNameSequence(),
    agents,
    ids: new SequentialIdGenerator('room'),
    uow: new InMemoryUnitOfWork(),
    outbox,
    clock,
    roomMetrics,
    traceContexts,
  });
  agents.pair('agent-1', 'account-1');
  agents.pair('agent-2', 'account-2');
  return { useCases, rooms, observations, outbox, agents, clock, roomMetrics, traceContexts };
}

/** The finished span with this name; the test fails when the use case did not open it. */
function finishedSpan(name: string): ReadableSpan {
  const span = exporter.getFinishedSpans().find((finished) => finished.name === name);
  if (span === undefined) {
    throw new Error(`no finished span named ${name}`);
  }
  return span;
}

/** The W3C traceparent of a finished span: version 00, its trace id, its span id and its flags. */
function traceparentOf(span: ReadableSpan): string {
  const { traceId, spanId, traceFlags } = span.spanContext();
  return `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, '0')}`;
}

function match(matchId = 'match-1'): MatchFormedPayload {
  return {
    matchId,
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
    ],
  };
}

function body(overrides: Partial<ObservationBody> = {}): ObservationBody {
  return {
    idempotencyKey: 'key-1',
    type: 'GAME_NAME_SEEN',
    run: 1,
    value: 'mmbaalh-1',
    confidence: 0.9,
    capturedAt: CAPTURED_AT,
    ...overrides,
  };
}

describe('lobby-room use cases', () => {
  it('creates no second room for the same match', async () => {
    const { useCases, outbox } = setup();

    const first = await useCases.onMatchFormed(match());
    const second = await useCases.onMatchFormed(match());

    expect(first).toEqual({ ok: true, value: 'created' });
    expect(second).toEqual({ ok: true, value: 'already-created' });
    expect(outbox.appended.map((event) => event.type)).toEqual(['RoomAssignmentChanged', 'RoomStageChanged']);
  });

  it('writes the assignment and the stage of the new room to the outbox', async () => {
    const { useCases, outbox } = setup();

    await useCases.onMatchFormed(match());

    expect(outbox.appended[0]).toMatchObject({
      type: 'RoomAssignmentChanged',
      payload: { roomId: 'room-1', run: 1, expectedGameName: 'mmbaalh-1' },
    });
    expect(outbox.appended[1]).toMatchObject({
      type: 'RoomStageChanged',
      payload: { roomId: 'room-1', stage: 'awaiting_host' },
    });
  });

  it('answers unsupported-difficulty and stores nothing for a difficulty F0 does not play', async () => {
    const { useCases, outbox } = setup();

    const result = await useCases.onMatchFormed({ ...match(), difficulty: 'normal' });

    expect(result).toEqual({ ok: false, error: 'unsupported-difficulty' });
    expect(outbox.appended).toEqual([]);
  });

  it('refuses an observation from an account outside the room with forbidden and stores nothing', async () => {
    const { useCases, observations, outbox, agents } = setup();
    await useCases.onMatchFormed(match());
    agents.pair('agent-9', 'account-9');

    const result = await useCases.recordObservation({
      agentId: 'agent-9',
      roomId: 'room-1',
      body: body(),
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(observations.stored).toEqual([]);
    expect(outbox.appended).toHaveLength(2);
  });

  it('accepts an UNKNOWN observation type and stores nothing', async () => {
    const { useCases, observations } = setup();
    await useCases.onMatchFormed(match());

    const result = await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: body({ type: 'UNKNOWN' }),
    });

    expect(result).toEqual({ ok: true, value: { stored: false } });
    expect(observations.stored).toEqual([]);
  });

  it('accepts a repeated idempotency key with no change and no event', async () => {
    const { useCases, observations, outbox } = setup();
    await useCases.onMatchFormed(match());
    await useCases.recordObservation({
      agentId: 'agent-2',
      roomId: 'room-1',
      body: body({ value: 'other' }),
    });
    const eventsBefore = outbox.appended.length;

    const repeated = await useCases.recordObservation({
      agentId: 'agent-2',
      roomId: 'room-1',
      body: body({ value: 'other' }),
    });

    expect(repeated).toEqual({ ok: true, value: { stored: false } });
    expect(observations.stored).toHaveLength(1);
    expect(outbox.appended).toHaveLength(eventsBefore);
  });

  it('moves the room to created on the host observation and writes the stage change', async () => {
    const { useCases, outbox } = setup();
    await useCases.onMatchFormed(match());

    const result = await useCases.recordObservation({ agentId: 'agent-1', roomId: 'room-1', body: body() });
    const room = await useCases.getCurrentRoom({ accountId: 'account-1' });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(room?.stage).toBe('created');
    expect(outbox.appended[2]).toMatchObject({
      type: 'RoomStageChanged',
      payload: { roomId: 'room-1', stage: 'created' },
    });
  });

  it('stores a member observation and leaves the stage unchanged', async () => {
    const { useCases, observations, outbox } = setup();
    await useCases.onMatchFormed(match());

    const result = await useCases.recordObservation({ agentId: 'agent-2', roomId: 'room-1', body: body() });
    const room = await useCases.getCurrentRoom({ accountId: 'account-1' });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toHaveLength(1);
    expect(room?.stage).toBe('awaiting_host');
    expect(outbox.appended).toHaveLength(2);
  });

  it('the newest of two rooms is current', async () => {
    const { useCases } = setup();
    await useCases.onMatchFormed(match('match-1'));
    await useCases.onMatchFormed(match('match-2'));

    const room = await useCases.getCurrentRoom({ accountId: 'account-1' });

    expect(room?.roomId).toBe('room-2');
    expect(room?.expectedGameName).toBe('mmbaalh-2');
  });

  it('returns the same assignment to the agent of a member', async () => {
    const { useCases } = setup();
    await useCases.onMatchFormed(match());

    const assignment = await useCases.getAssignment({ agentId: 'agent-2' });

    expect(assignment).toMatchObject({ roomId: 'room-1', run: 1, expectedGameName: 'mmbaalh-1' });
    expect(assignment?.members.map((member) => member.accountId)).toEqual(['account-1', 'account-2']);
  });

  it('returns no assignment for an agent that is not paired', async () => {
    const { useCases } = setup();
    await useCases.onMatchFormed(match());

    expect(await useCases.getAssignment({ agentId: 'agent-unpaired' })).toBeNull();
  });

  it('records room.stage_duration once with the seconds since the room opened', async () => {
    const { useCases, clock, roomMetrics } = setup();
    await useCases.onMatchFormed(match());
    clock.advance(90 * 1000);

    await useCases.recordObservation({ agentId: 'agent-1', roomId: 'room-1', body: body() });
    await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: body({ idempotencyKey: 'key-2' }),
    });

    expect(roomMetrics.calls).toEqual([
      { stage: 'awaiting_host', difficulty: 'hell', mode: 'leveling', seconds: 90 },
    ]);
  });

  it('openedAt returns the instant the room opened', async () => {
    const { useCases, rooms } = setup();
    await useCases.onMatchFormed(match());

    expect(await rooms.openedAt('room-1')).toEqual(OPENED_AT);
    expect(await rooms.openedAt('room-404')).toBeUndefined();
  });

  it('opens the span lobby.record-observation', async () => {
    const { useCases } = setup();
    await useCases.onMatchFormed(match());

    await useCases.recordObservation({ agentId: 'agent-1', roomId: 'room-1', body: body() });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toContain('lobby.record-observation');
  });

  it('no span of lobby or matchmaking carries an account or agent id and the room id uses the d2r constant', async () => {
    const { useCases } = setup();
    await useCases.onMatchFormed(match());
    await useCases.recordObservation({ agentId: 'agent-1', roomId: 'room-1', body: body() });
    await useCases.getCurrentRoom({ accountId: 'account-1' });
    await useCases.getAssignment({ agentId: 'agent-2' });
    const matchmaking = createMatchmakingUseCases({
      ids: new SequentialIdGenerator('match'),
      uow: new InMemoryUnitOfWork(),
      outbox: new RecordingOutbox(),
    });
    await matchmaking.formTestMatch({ accountId: 'account-1' });

    const spans = exporter.getFinishedSpans();
    const names = spans.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'lobby.record-observation',
        'lobby.get-current-room',
        'lobby.get-assignment',
        'matchmaking.form-test-match',
      ]),
    );
    const observation = spans.find((span) => span.name === 'lobby.record-observation');
    expect(observation?.attributes).toEqual({ [D2R_ROOM_ID]: 'room-1' });
    expect(D2R_ROOM_ID).toBe('d2r.room.id');
    for (const span of spans) {
      expect(Object.keys(span.attributes)).not.toContain('accountId');
      expect(Object.keys(span.attributes)).not.toContain('agentId');
      expect(Object.keys(span.attributes)).not.toContain('roomId');
    }
  });
});

describe('the room trace context', () => {
  it('stores the traceparent active when the room opens', async () => {
    const { useCases, traceContexts } = setup();

    await withSpan('outbox.relay', {}, () => useCases.onMatchFormed(match()));

    const opened = finishedSpan('lobby.on-match-formed');
    expect(await traceContexts.find('room-1')).toBe(traceparentOf(opened));
    expect(opened.spanContext().traceId).toBe(finishedSpan('outbox.relay').spanContext().traceId);
  });

  it('stores no traceparent when no span is active', async () => {
    trace.disable();
    try {
      const { useCases, traceContexts, outbox } = setup();

      await useCases.onMatchFormed(match());

      expect(outbox.appended).toHaveLength(2);
      expect(await traceContexts.find('room-1')).toBeNull();
    } finally {
      trace.setGlobalTracerProvider(provider);
    }
  });

  it('records nothing for a match that already has a room', async () => {
    const { useCases, traceContexts } = setup();
    await withSpan('outbox.relay', {}, () => useCases.onMatchFormed(match()));
    const first = await traceContexts.find('room-1');

    const second = await withSpan('outbox.relay', {}, () => useCases.onMatchFormed(match()));

    expect(second).toEqual({ ok: true, value: 'already-created' });
    expect(first).not.toBeNull();
    expect(await traceContexts.find('room-1')).toBe(first);
  });

  it("keeps the traceparent out of the room's events and views", async () => {
    const { useCases, traceContexts, outbox } = setup();
    await withSpan('outbox.relay', {}, () => useCases.onMatchFormed(match()));
    const stored = await traceContexts.find('room-1');
    expect(stored).not.toBeNull();

    const room = await useCases.getCurrentRoom({ accountId: 'account-1' });
    const assignment = await useCases.getAssignment({ agentId: 'agent-2' });

    expect(Object.keys(room ?? {})).toEqual([
      'roomId',
      'mode',
      'activity',
      'difficulty',
      'stage',
      'run',
      'expectedGameName',
      'password',
      'members',
    ]);
    expect(Object.keys(assignment ?? {})).toEqual(['roomId', 'run', 'expectedGameName', 'members']);
    expect(JSON.stringify([outbox.appended, room, assignment])).not.toContain(stored ?? '');
  });
});
