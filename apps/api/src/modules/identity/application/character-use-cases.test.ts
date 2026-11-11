import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import type { CharacterInput } from '../domain/character/character.ts';
import { createCharacterUseCases } from './character-use-cases.ts';
import { InMemoryCharacterRepository } from './testing/in-memory-character-repository.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';

const START = new Date('2026-11-10T12:00:00.000Z');
const LATER = new Date('2026-11-10T12:00:05.000Z');

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

const sorc: CharacterInput = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

function setup() {
  const clock = new FakeClock(START);
  const characters = new InMemoryCharacterRepository();
  const outbox = new RecordingOutbox();
  const useCases = createCharacterUseCases({
    characters,
    uow: new InMemoryUnitOfWork(),
    outbox,
    clock,
  });
  return { clock, characters, outbox, useCases };
}

describe('recordCharacters (CHR-09)', () => {
  it('answers the count of the stored batch', async () => {
    const { useCases } = setup();

    const result = await useCases.recordCharacters({
      accountId: 'alice',
      characters: [sorc, { ...sorc, name: 'Hammer', class: 'paladin', ladder: 'hc-ladder' }],
    });

    expect(result).toEqual({ ok: true, value: { count: 2 } });
  });

  it('creates a character on its first reading with the read time', async () => {
    const { useCases, characters } = setup();

    const result = await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });

    expect(result).toEqual({ ok: true, value: { count: 1 } });
    expect(await characters.listByAccount('alice')).toEqual([{ ...sorc, readAt: START }]);
  });

  it('replaces the fields of a character with the newest reading', async () => {
    const { useCases, characters, clock } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    clock.advance(LATER.getTime() - START.getTime());

    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [{ ...sorc, level: 88, unlockedDifficulties: ['normal', 'nightmare', 'hell'] }],
    });

    const stored = await characters.listByAccount('alice');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Sorc', level: 88, readAt: LATER });
  });

  it('stores a name once whatever its case and keeps the newest spelling (CHR-10)', async () => {
    const { useCases, characters, clock } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    clock.advance(LATER.getTime() - START.getTime());

    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [{ ...sorc, name: 'sorc', level: 88 }],
    });

    const stored = await characters.listByAccount('alice');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'sorc', level: 88, readAt: LATER });
  });

  it('keeps a character of another account apart from the same name', async () => {
    const { useCases, characters } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });

    await useCases.recordCharacters({ accountId: 'bob', characters: [{ ...sorc, level: 40 }] });

    expect(await characters.listByAccount('alice')).toHaveLength(1);
    expect(await characters.listByAccount('alice')).toMatchObject([{ level: 85 }]);
    expect(await characters.listByAccount('bob')).toMatchObject([{ level: 40 }]);
  });

  it('writes CharactersRecorded for the account to the outbox', async () => {
    const { useCases, outbox } = setup();

    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });

    expect(outbox.appended).toEqual([{ type: 'CharactersRecorded', payload: { accountId: 'alice' } }]);
  });

  it('refuses a batch that breaks a rule and stores none of it, writes no outbox row', async () => {
    const { useCases, characters, outbox } = setup();

    const result = await useCases.recordCharacters({
      accountId: 'alice',
      characters: [sorc, { ...sorc, name: 'Pally', level: 100 }],
    });

    expect(result).toEqual({ ok: false, error: 'invalid-characters' });
    expect(await characters.listByAccount('alice')).toEqual([]);
    expect(outbox.appended).toEqual([]);
  });

  it('records the span with the count only, never a name', async () => {
    const { useCases } = setup();

    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });

    const span = exporter
      .getFinishedSpans()
      .find((finished) => finished.name === 'identity.record-characters');
    expect(span?.attributes).toEqual({ 'd2r.characters.count': 1 });
    expect(JSON.stringify(span?.attributes)).not.toContain('Sorc');
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
  });
});

/** Three letters per index, so every name is letters only and unique from 0 to 17575. */
function lettersOf(index: number): string {
  let rest = index;
  let out = '';
  for (let place = 0; place < 3; place++) {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

/** `count` distinct characters, from `from` on, named `Hero<letters>`. */
function heroes(count: number, from = 0): CharacterInput[] {
  return Array.from({ length: count }, (_, index) => ({ ...sorc, name: `Hero${lettersOf(from + index)}` }));
}

describe('account limit of 60 characters (security finding 2)', () => {
  it('stores a batch that brings the account to exactly 60 names', async () => {
    const { useCases, characters } = setup();

    expect(await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24) })).toEqual({
      ok: true,
      value: { count: 24 },
    });
    expect(await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24, 24) })).toEqual({
      ok: true,
      value: { count: 24 },
    });
    expect(await useCases.recordCharacters({ accountId: 'alice', characters: heroes(12, 48) })).toEqual({
      ok: true,
      value: { count: 12 },
    });

    expect(await characters.listByAccount('alice')).toHaveLength(60);
  });

  it('refuses a batch that would pass 60 new names, stores none of it and writes no outbox row', async () => {
    const { useCases, characters, outbox } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24, 24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(12, 48) });
    const appendedBefore = outbox.appended.length;

    const result = await useCases.recordCharacters({
      accountId: 'alice',
      characters: heroes(2, 60),
    });

    expect(result).toEqual({ ok: false, error: 'too-many-characters' });
    expect(await characters.listByAccount('alice')).toHaveLength(60);
    expect(outbox.appended).toHaveLength(appendedBefore);
  });

  it('accepts a batch of names the account already holds when it is at the limit', async () => {
    const { useCases, characters } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24, 24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(12, 48) });

    const result = await useCases.recordCharacters({
      accountId: 'alice',
      characters: heroes(24).map((character) => ({ ...character, level: 90 })),
    });

    expect(result).toEqual({ ok: true, value: { count: 24 } });
    expect(await characters.listByAccount('alice')).toHaveLength(60);
  });

  it('counts only the new names of a mixed batch against the limit', async () => {
    const { useCases, characters } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24, 24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(10, 48) });

    const mixed = await useCases.recordCharacters({
      accountId: 'alice',
      characters: [...heroes(1), ...heroes(2, 58)],
    });
    expect(mixed).toEqual({ ok: true, value: { count: 3 } });
    expect(await characters.listByAccount('alice')).toHaveLength(60);

    const onMore = await useCases.recordCharacters({ accountId: 'alice', characters: heroes(1, 60) });
    expect(onMore).toEqual({ ok: false, error: 'too-many-characters' });
  });

  it('does not count the characters of another account', async () => {
    const { useCases, characters } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(24, 24) });
    await useCases.recordCharacters({ accountId: 'alice', characters: heroes(12, 48) });

    const result = await useCases.recordCharacters({ accountId: 'bob', characters: heroes(24, 60) });

    expect(result).toEqual({ ok: true, value: { count: 24 } });
    expect(await characters.listByAccount('bob')).toHaveLength(24);
  });
});

describe('listMyCharacters (CHR-11)', () => {
  it('lists only the signed-in account characters, ordered by name', async () => {
    const { useCases } = setup();
    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [sorc, { ...sorc, name: 'Amy', class: 'amazon', era: 'classic', ladder: 'hc-nonladder' }],
    });
    await useCases.recordCharacters({ accountId: 'bob', characters: [{ ...sorc, name: 'Bobby' }] });

    const listed = await useCases.listMyCharacters({ accountId: 'alice' });

    expect(listed.map((character) => character.name)).toEqual(['Amy', 'Sorc']);
  });

  it('lists nothing for an account without characters', async () => {
    const { useCases } = setup();

    expect(await useCases.listMyCharacters({ accountId: 'carol' })).toEqual([]);
  });
});
