// Wires the queue use cases over the in-memory doubles, with a fake clock the test moves.
import { FakeClock, SequentialIdGenerator } from '../../../../shared-kernel/index.ts';
import type { EntryCharacter } from '../../domain/entry-rules.ts';
import { createQueueUseCases } from '../queue-use-cases.ts';
import { InMemoryUnitOfWork } from './in-memory-unit-of-work.ts';
import { RecordingOutbox } from './recording-outbox.ts';
import {
  FakeAccountFacts,
  FakeCharacters,
  FixedRatings,
  InMemoryQueueStore,
  RecordingEventBus,
  RecordingQueueMetrics,
} from './queue-fakes.ts';

export const START = new Date('2026-11-10T12:00:00.000Z');

/** A level 90 softcore Sorceress on the ladder, Reign of the Warlock, with every difficulty unlocked. */
export const READY_CHARACTER: EntryCharacter = {
  level: 90,
  hardcore: false,
  ladder: 'ladder',
  era: 'rotw',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

export function queueSetup() {
  const clock = new FakeClock(START);
  const store = new InMemoryQueueStore();
  const characters = new FakeCharacters();
  const facts = new FakeAccountFacts();
  const ratings = new FixedRatings();
  const bus = new RecordingEventBus();
  const metrics = new RecordingQueueMetrics();
  const outbox = new RecordingOutbox();
  const queue = createQueueUseCases({
    store,
    characters,
    presence: facts,
    links: facts,
    sites: facts,
    rooms: facts,
    ratings,
    ids: new SequentialIdGenerator('t'),
    clock,
    uow: new InMemoryUnitOfWork(),
    outbox,
    bus,
    metrics,
  });
  /** Makes an account ready to queue with a character it owns. */
  const readyPlayer = (
    accountId: string,
    characterId: string,
    character: EntryCharacter = READY_CHARACTER,
  ) => {
    facts.readyToQueue(accountId);
    characters.set(accountId, characterId, character);
  };
  return { clock, store, characters, facts, ratings, bus, metrics, outbox, queue, readyPlayer };
}

export type QueueSetup = ReturnType<typeof queueSetup>;
