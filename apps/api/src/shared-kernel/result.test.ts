import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok, type Result } from './result.ts';

describe('Result', () => {
  it('ok carries the exact value, including falsy values', () => {
    const zero: Result<number, string> = ok(0);
    const empty: Result<string, string> = ok('');

    expect(isOk(zero) && zero.value).toBe(0);
    expect(isOk(empty) && empty.value).toBe('');
  });

  it('ok carries the same object reference it was given', () => {
    const payload = { seats: 8 };
    const result: Result<{ seats: number }, string> = ok(payload);

    expect(isOk(result) && result.value).toBe(payload);
  });

  it('err carries the exact error, including falsy errors', () => {
    const numeric: Result<string, number> = err(0);
    const reason: Result<string, { code: string }> = err({ code: 'not-found' });

    expect(isErr(numeric) && numeric.error).toBe(0);
    expect(isErr(reason) && reason.error).toEqual({ code: 'not-found' });
  });

  it('isOk is true for an ok result and false for an err result', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err('boom'))).toBe(false);
  });

  it('isErr is true for an err result and false for an ok result', () => {
    expect(isErr(err('boom'))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  it('isOk and isErr are mutually exclusive for both variants', () => {
    const success: Result<number, string> = ok(1);
    const failure: Result<number, string> = err('boom');

    expect(isOk(success) === isErr(success)).toBe(false);
    expect(isOk(failure) === isErr(failure)).toBe(false);
  });
});
