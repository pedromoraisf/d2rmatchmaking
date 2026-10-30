import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator } from './id-generator.ts';

describe('SequentialIdGenerator', () => {
  it('yields id-1, id-2, id-3 with the default prefix', () => {
    const ids = new SequentialIdGenerator();

    expect([ids.next(), ids.next(), ids.next()]).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('yields room-1, room-2 with a custom prefix', () => {
    const ids = new SequentialIdGenerator('room');

    expect([ids.next(), ids.next()]).toEqual(['room-1', 'room-2']);
  });

  it('two generators do not share a counter', () => {
    const first = new SequentialIdGenerator();
    const second = new SequentialIdGenerator();

    expect(first.next()).toBe('id-1');
    expect(first.next()).toBe('id-2');
    expect(second.next()).toBe('id-1');
    expect(first.next()).toBe('id-3');
  });
});
