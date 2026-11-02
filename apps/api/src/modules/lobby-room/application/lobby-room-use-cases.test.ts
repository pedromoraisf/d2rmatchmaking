import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { D2R_ROOM_ID } from '@d2rmm/telemetry';
import { SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import { createMatchmakingUseCases } from '../../matchmaking/index.ts';
import { createLobbyRoomUseCases, type ObservationBody } from './lobby-room-use-cases.ts';
import { FakeAgentsPort } from './testing/fake-agents-port.ts';
import { InMemoryGameNameSequence } from './testing/in-memory-game-name-sequence.ts';
import { InMemoryLobbyRoomRepository } from './testing/in-memory-lobby-room-repository.ts';
import { InMemoryObservationRepository } from './testing/in-memory-observation-repository.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const CAPTURED_AT = new Date('2026-10-31T10:00:00.000Z');

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

function setup() {
  const rooms = new InMemoryLobbyRoomRepository();
  const observations = new InMemoryObservationRepository();
  const agents = new FakeAgentsPort();
  const outbox = new RecordingOutbox();
  const useCases = createLobbyRoomUseCases({
    rooms,
    observations,
    sequence: new InMemoryGameNameSequence(),
    agents,
    ids: new SequentialIdGenerator('room'),
    uow: new InMemoryUnitOfWork(),
    outbox,
  });
  agents.pair('agent-1', 'account-1');
  agents.pair('agent-2', 'account-2');
  return { useCases, observations, outbox, agents };
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
