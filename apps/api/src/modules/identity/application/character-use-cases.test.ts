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

// What the agent reads on the selection screen: no ladder and no era (CHR-06, CHR-15).
const sorc: CharacterInput = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  hardcore: false,
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
      characters: [sorc, { ...sorc, name: 'Hammer', class: 'paladin', hardcore: true }],
    });

    expect(result).toEqual({ ok: true, value: { count: 2 } });
  });

  it('creates a character on its first reading with the read time', async () => {
    const { useCases, characters } = setup();

    const result = await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });

    expect(result).toEqual({ ok: true, value: { count: 1 } });
    expect(await characters.listByAccount('alice')).toEqual([
      { ...sorc, id: expect.any(String), ladder: null, era: null, readAt: START },
    ]);
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

describe('a reading keeps what the player declared (CHR-09, CHR-15)', () => {
  it('replaces the reading and keeps the declared ladder and era', async () => {
    const { useCases, characters, clock } = setup();
    await useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    const [stored] = await characters.listByAccount('alice');
    await useCases.declareCharacter({
      accountId: 'alice',
      characterId: stored?.id ?? '',
      ladder: 'ladder',
      era: 'rotw',
    });
    clock.advance(LATER.getTime() - START.getTime());

    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [{ ...sorc, name: 'sorc', level: 86 }],
    });

    expect(await characters.listByAccount('alice')).toMatchObject([
      { id: stored?.id, name: 'sorc', level: 86, ladder: 'ladder', era: 'rotw', readAt: LATER },
    ]);
  });
});

describe('declareCharacter (CHR-15, CHR-16)', () => {
  async function recordedSorc() {
    const fixture = setup();
    await fixture.useCases.recordCharacters({ accountId: 'alice', characters: [sorc] });
    const [stored] = await fixture.characters.listByAccount('alice');
    return { ...fixture, characterId: stored?.id ?? '' };
  }

  it('stores the declared ladder and era for the player character', async () => {
    const { useCases, characters, characterId } = await recordedSorc();

    const result = await useCases.declareCharacter({
      accountId: 'alice',
      characterId,
      ladder: 'non-ladder',
      era: 'lod',
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await characters.listByAccount('alice')).toMatchObject([{ ladder: 'non-ladder', era: 'lod' }]);
  });

  it('answers not-found for a character of another account and changes nothing', async () => {
    const { useCases, characters, characterId } = await recordedSorc();

    const result = await useCases.declareCharacter({
      accountId: 'bob',
      characterId,
      ladder: 'ladder',
      era: 'classic',
    });

    expect(result).toEqual({ ok: false, error: 'not-found' });
    expect(await characters.listByAccount('alice')).toMatchObject([{ ladder: null, era: null }]);
  });

  it('answers not-found for an id the account does not hold', async () => {
    const { useCases } = await recordedSorc();

    expect(
      await useCases.declareCharacter({
        accountId: 'alice',
        characterId: 'missing',
        ladder: 'ladder',
        era: 'lod',
      }),
    ).toEqual({ ok: false, error: 'not-found' });
  });

  it('refuses a declaration outside the ladder flags and eras and changes nothing', async () => {
    const { useCases, characters, characterId } = await recordedSorc();

    const result = await useCases.declareCharacter({
      accountId: 'alice',
      characterId,
      ladder: 'sc-ladder',
      era: 'lod',
    });

    expect(result).toEqual({ ok: false, error: 'invalid-declaration' });
    expect(await characters.listByAccount('alice')).toMatchObject([{ ladder: null, era: null }]);
  });

  it('records the span with no character name', async () => {
    const { useCases, characterId } = await recordedSorc();
    exporter.reset();

    await useCases.declareCharacter({ accountId: 'alice', characterId, ladder: 'ladder', era: 'lod' });

    const span = exporter
      .getFinishedSpans()
      .find((finished) => finished.name === 'identity.declare-character');
    expect(span).toBeDefined();
    expect(JSON.stringify(span?.attributes ?? {})).not.toContain('Sorc');
  });
});

describe('listMyCharacters (CHR-11)', () => {
  it('lists only the signed-in account characters, ordered by name', async () => {
    const { useCases } = setup();
    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [sorc, { ...sorc, name: 'Amy', class: 'amazon', hardcore: true }],
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
