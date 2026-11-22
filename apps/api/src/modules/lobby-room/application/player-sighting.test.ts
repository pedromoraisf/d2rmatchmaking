// SNM-03, SNM-04, SNM-08: a chat sighting is matched to a member of the room, only the join order is stored, and the read
// name goes nowhere else. Fakes for every port; the room has Alice (Sorc) and Bob (Hammer).
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
import { FakeMemberConnectivity } from './testing/in-memory-member-connectivity.ts';
import { InMemoryGameNameSequence } from './testing/in-memory-game-name-sequence.ts';
import { InMemoryLobbyRoomRepository } from './testing/in-memory-lobby-room-repository.ts';
import { InMemoryObservationRepository } from './testing/in-memory-observation-repository.ts';
import { InMemoryRoomTraceContexts } from './testing/in-memory-room-trace-contexts.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

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

const MATCH: MatchFormedPayload = {
  matchId: 'match-1',
  mode: 'pvp',
  activity: 'pvp',
  difficulty: 'hell',
  region: 'americas',
  ladder: 'sc-ladder',
  era: 'rotw',
  members: [
    { accountId: 'account-1', characterId: 'char-1', joinOrder: 1, role: 'host' },
    { accountId: 'account-2', characterId: 'char-2', joinOrder: 2, role: 'member' },
  ],
};

async function setup() {
  const clock = new FakeClock(new Date('2026-10-31T09:55:00.000Z'));
  const rooms = new InMemoryLobbyRoomRepository(clock);
  const observations = new InMemoryObservationRepository();
  const agents = new FakeAgentsPort();
  const outbox = new RecordingOutbox();
  const characters = new FakeRoomCharacters();
  characters.add('account-1', 'char-1', 'sorceress', 85, 'Sorc');
  characters.add('account-2', 'char-2', 'paladin', 90, 'Hammer');
  const useCases = createLobbyRoomUseCases({
    rooms,
    observations,
    sequence: new InMemoryGameNameSequence(),
    agents,
    ids: new SequentialIdGenerator('room'),
    uow: new InMemoryUnitOfWork(),
    outbox,
    clock,
    roomMetrics: new FakeRoomMetrics(),
    traceContexts: new InMemoryRoomTraceContexts(),
    connectivity: new FakeMemberConnectivity(),
    characters,
    dropToleranceMs: 60_000,
  });
  agents.pair('agent-1', 'account-1');
  agents.pair('agent-2', 'account-2');
  agents.pair('agent-9', 'account-9');
  await useCases.onMatchFormed(MATCH);
  const eventsBefore = outbox.appended.length;
  return { useCases, rooms, observations, outbox, characters, eventsBefore };
}

function sighting(value: string, overrides: Partial<ObservationBody> = {}): ObservationBody {
  return {
    idempotencyKey: `key-${value}`,
    type: 'PLAYER_JOINED_SEEN',
    run: 1,
    value,
    confidence: 0.9,
    capturedAt: new Date('2026-10-31T10:00:00.000Z'),
    ...overrides,
  };
}

describe('a chat sighting (SNM-03)', () => {
  it('stores the join order of the member it names, not the name', async () => {
    const { useCases, observations } = await setup();

    const result = await useCases.recordObservation({
      agentId: 'agent-2',
      roomId: 'room-1',
      body: sighting('Sorc'),
    });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toHaveLength(1);
    expect(observations.stored[0]).toMatchObject({
      type: 'PLAYER_JOINED_SEEN',
      value: '1',
      agentId: 'agent-2',
      run: 1,
    });
  });

  it.each([
    ['sorc', '1'],
    ['Sgrc', '1'],
    ['Sbrc', '1'],
    ['S0rc', '1'],
    ['HAMMER', '2'],
  ])('a misread %s still finds the member', async (read, order) => {
    const { useCases, observations } = await setup();

    await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting(read, { type: 'PLAYER_LEFT_SEEN' }),
    });

    expect(observations.stored.map((observation) => [observation.type, observation.value])).toEqual([
      ['PLAYER_LEFT_SEEN', order],
    ]);
  });

  it.each(['Zzyzx', 'Sorg', 'Hamner', 'Sorcc'])(
    'stores nothing for %s, who is nobody in the room',
    async (read) => {
      const { useCases, observations, outbox, eventsBefore } = await setup();

      const result = await useCases.recordObservation({
        agentId: 'agent-1',
        roomId: 'room-1',
        body: sighting(read),
      });

      expect(result).toEqual({ ok: true, value: { stored: true } });
      expect(observations.stored).toEqual([]);
      expect(outbox.appended).toHaveLength(eventsBefore);
    },
  );

  it('stores nothing when the name stands for two members', async () => {
    const { useCases, observations, characters } = await setup();
    characters.add('account-2', 'char-2', 'paladin', 90, 'S0rc');

    const result = await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting('Sgrc'),
    });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toEqual([]);
  });

  it('ignores a member who queued without a character', async () => {
    const { useCases, observations } = await setup();
    await useCases.onMatchFormed({
      ...MATCH,
      matchId: 'match-2',
      members: [
        { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
        { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
      ],
    });

    const result = await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-2',
      body: sighting('Sorc'),
    });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toEqual([]);
  });

  it('is idempotent: the same key stores once', async () => {
    const { useCases, observations } = await setup();
    const body = sighting('Sorc');

    await useCases.recordObservation({ agentId: 'agent-2', roomId: 'room-1', body });
    const again = await useCases.recordObservation({ agentId: 'agent-2', roomId: 'room-1', body });

    expect(again).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toHaveLength(1);
  });

  it.each(['S', 'Sorc Sorc', 'Sorc2', 'ThisNameIsTooLongXX', '0Sorc', ''])(
    'refuses %j as invalid and stores nothing',
    async (value) => {
      const { useCases, observations } = await setup();

      const result = await useCases.recordObservation({
        agentId: 'agent-1',
        roomId: 'room-1',
        body: sighting(value),
      });

      expect(result).toEqual({ ok: false, error: 'invalid-observation' });
      expect(observations.stored).toEqual([]);
    },
  );

  it('leaves the other observation types as they were', async () => {
    const { useCases, observations } = await setup();

    await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting('anything goes here, up to 64 characters', {
        type: 'SCREEN_CHANGED',
        idempotencyKey: 'k-screen',
      }),
    });

    expect(observations.stored[0]?.value).toBe('anything goes here, up to 64 characters');
  });
});

describe('a chat sighting grants no authority (SNM-08)', () => {
  it('changes no room state and sends no event', async () => {
    const { useCases, rooms, outbox, eventsBefore } = await setup();
    const before = await rooms.findById('room-1');

    await useCases.recordObservation({ agentId: 'agent-2', roomId: 'room-1', body: sighting('Sorc') });
    await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting('Hammer', { type: 'PLAYER_LEFT_SEEN' }),
    });

    expect(outbox.appended).toHaveLength(eventsBefore);
    const after = await rooms.findById('room-1');
    expect(after?.stage).toBe(before?.stage);
    expect(after?.members.map((member) => member.confirmed)).toEqual(
      before?.members.map((member) => member.confirmed),
    );
  });

  it('refuses an agent that is not in the room', async () => {
    const { useCases, observations } = await setup();

    const result = await useCases.recordObservation({
      agentId: 'agent-9',
      roomId: 'room-1',
      body: sighting('Sorc'),
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(observations.stored).toEqual([]);
  });
});

describe('the read name goes nowhere else (SNM-04)', () => {
  it('is on no span, only the fixed words of the match', async () => {
    const { useCases } = await setup();
    exporter.reset();

    await useCases.recordObservation({ agentId: 'agent-2', roomId: 'room-1', body: sighting('Sgrc') });
    await useCases.recordObservation({
      agentId: 'agent-2',
      roomId: 'room-1',
      body: sighting('Zzyzx', { idempotencyKey: 'k-none' }),
    });

    const spans = exporter.getFinishedSpans().filter((span) => span.name === 'lobby.record-observation');
    expect(spans.map((span) => span.attributes['d2r.observation.match'])).toEqual(['matched', 'none']);
    for (const span of spans) {
      const text = JSON.stringify([span.attributes, span.events, span.links]).toLowerCase();
      expect(text).not.toContain('sgrc');
      expect(text).not.toContain('zzyzx');
      expect(text).not.toContain('sorc');
    }
  });
});

describe('the answer to a sighting tells nothing about a match (security review of #101)', () => {
  it('is the same for a match, a miss, an ambiguous name and a replay', async () => {
    const { useCases, characters } = await setup();
    characters.add('account-2', 'char-2', 'paladin', 90, 'Hammer');
    characters.add('account-1', 'char-9', 'sorceress', 80, 'S0rc');
    const answers = [];
    for (const [value, key] of [
      ['Hammer', 'k-hit'],
      ['Zzyzx', 'k-miss'],
      ['Hammer', 'k-hit'],
      ['Zzyzx', 'k-miss'],
    ] as const) {
      answers.push(
        await useCases.recordObservation({
          agentId: 'agent-1',
          roomId: 'room-1',
          body: sighting(value, { idempotencyKey: key }),
        }),
      );
    }

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]).toEqual({ ok: true, value: { stored: true } });
  });
});

describe('the member names are read in one query (security review of #101)', () => {
  it('looks every member up with one call, whatever the size of the room', async () => {
    const { useCases, characters } = await setup();
    characters.nameLookups.length = 0;

    await useCases.recordObservation({ agentId: 'agent-1', roomId: 'room-1', body: sighting('Sorc') });
    await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting('Zzyzx', { idempotencyKey: 'k2' }),
    });

    expect(characters.nameLookups).toEqual([2, 2]);
  });
});

describe('a sighting that names two members (SNM-02)', () => {
  it('stores nothing and says on the span that the name was ambiguous', async () => {
    const { useCases, observations, characters } = await setup();
    characters.add('account-2', 'char-2', 'paladin', 90, 'Sorc');
    exporter.reset();

    const result = await useCases.recordObservation({
      agentId: 'agent-1',
      roomId: 'room-1',
      body: sighting('Sorc'),
    });

    expect(result).toEqual({ ok: true, value: { stored: true } });
    expect(observations.stored).toEqual([]);
    const span = exporter.getFinishedSpans().find((finished) => finished.name === 'lobby.record-observation');
    expect(span?.attributes['d2r.observation.match']).toBe('ambiguous');
  });
});
