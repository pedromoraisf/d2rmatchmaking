import { describe, expect, it } from 'vitest';
import { SeededRandomSource } from './random-source.ts';

describe('SeededRandomSource', () => {
  it('int(10) stays in [0, 10) over many draws', () => {
    const random = new SeededRandomSource(42);

    const draws = Array.from({ length: 1000 }, () => random.int(10));

    expect(draws.every((n) => Number.isInteger(n) && n >= 0 && n < 10)).toBe(true);
  });

  it('int(10) repeats the same sequence for the same seed', () => {
    const first = new SeededRandomSource(7);
    const second = new SeededRandomSource(7);

    const a = Array.from({ length: 20 }, () => first.int(10));
    const b = Array.from({ length: 20 }, () => second.int(10));

    expect(a).toEqual(b);
  });

  it('a different seed gives a different sequence', () => {
    const a = Array.from({ length: 20 }, () => new SeededRandomSource(1).int(1_000_000));
    const b = Array.from({ length: 20 }, () => new SeededRandomSource(2).int(1_000_000));

    expect(a).not.toEqual(b);
  });

  it('int(1) is always 0', () => {
    const random = new SeededRandomSource(9);

    expect(Array.from({ length: 50 }, () => random.int(1))).toEqual(new Array<number>(50).fill(0));
  });

  it('int rejects a bound below 1, a non-integer bound and a bound above 2^32', () => {
    const random = new SeededRandomSource(3);

    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.int(2.5)).toThrow(RangeError);
    expect(() => random.int(2 ** 32 + 1)).toThrow(RangeError);
  });

  it('bytes(32) has 32 bytes, each in 0..255', () => {
    const bytes = new SeededRandomSource(5).bytes(32);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(Array.from(bytes).every((b) => b >= 0 && b <= 255)).toBe(true);
  });

  it('bytes repeats for the same seed and returns the requested length for odd sizes', () => {
    expect(Array.from(new SeededRandomSource(11).bytes(7))).toEqual(
      Array.from(new SeededRandomSource(11).bytes(7)),
    );
    expect(new SeededRandomSource(11).bytes(7).length).toBe(7);
    expect(new SeededRandomSource(11).bytes(0).length).toBe(0);
  });

  it('bytes rejects a negative or non-integer length', () => {
    const random = new SeededRandomSource(4);

    expect(() => random.bytes(-1)).toThrow(RangeError);
    expect(() => random.bytes(1.5)).toThrow(RangeError);
  });

  it('int names the bound it needs when it refuses one', () => {
    expect(() => new SeededRandomSource(3).int(0)).toThrow('int needs an integer bound between 1 and 2^32');
  });

  it('bytes names the length it needs when it refuses a negative one', () => {
    expect(() => new SeededRandomSource(4).bytes(-1)).toThrow('bytes needs a non-negative integer length');
  });

  it('int skips a draw that lands on the largest multiple of the bound', () => {
    // The bound equals the first draw of seed 1. The accepted range ends at that draw, so it is rejected.
    expect(new SeededRandomSource(1).int(2_693_262_067)).toBe(11_749_833);
  });
});

describe('SeededRandomSource stream (mulberry32, seed 1)', () => {
  it('int accepts the bound 2^32 and draws the full 32-bit stream', () => {
    const random = new SeededRandomSource(1);

    expect([random.int(2 ** 32), random.int(2 ** 32), random.int(2 ** 32)]).toEqual([
      2693262067, 11749833, 2265367787,
    ]);
  });

  it('bytes packs each 32-bit word least significant byte first', () => {
    expect(Array.from(new SeededRandomSource(1).bytes(4))).toEqual([243, 234, 135, 160]);
  });

  it('bytes draws one word per four bytes, so two bytes(4) calls equal one bytes(8)', () => {
    const random = new SeededRandomSource(1);
    const joined = [...random.bytes(4), ...random.bytes(4)];

    expect(joined).toEqual(Array.from(new SeededRandomSource(1).bytes(8)));
    expect(joined).toEqual([243, 234, 135, 160, 201, 73, 179, 0]);
  });
});
