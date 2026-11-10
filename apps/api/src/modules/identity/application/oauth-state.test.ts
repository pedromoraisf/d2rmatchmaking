import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import {
  checkCallback,
  encodeOAuthAttempt,
  OAUTH_STATE_LIFETIME_MS,
  s256Challenge,
  startOAuthAttempt,
  type CallbackQuery,
} from './oauth-state.ts';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

/** A fresh attempt started at NOW, its cookie value, and the query Battle.net sends back for it. */
function attemptAt(now: Date = NOW) {
  const attempt = startOAuthAttempt(new SeededRandomSource(20), now);
  const cookie = encodeOAuthAttempt(attempt);
  const query: CallbackQuery = { code: 'auth-code-1', state: attempt.state };
  return { attempt, cookie, query };
}

describe('startOAuthAttempt', () => {
  it('draws a 43-character state and verifier from the injected random source', () => {
    const attempt = startOAuthAttempt(new SeededRandomSource(20), NOW);

    expect(attempt.state).toMatch(BASE64URL_43);
    expect(attempt.verifier).toMatch(BASE64URL_43);
    expect(attempt.state).not.toBe(attempt.verifier);
  });

  it('is deterministic for the same seed and different for another', () => {
    const first = startOAuthAttempt(new SeededRandomSource(20), NOW);
    const same = startOAuthAttempt(new SeededRandomSource(20), NOW);
    const other = startOAuthAttempt(new SeededRandomSource(21), NOW);

    expect(same).toEqual(first);
    expect(other.state).not.toBe(first.state);
  });

  it('sends the S256 challenge of its verifier, which is base64url of the SHA-256 of the verifier', () => {
    const attempt = startOAuthAttempt(new SeededRandomSource(20), NOW);
    const expected = createHash('sha256').update(attempt.verifier).digest('base64url');

    expect(attempt.codeChallenge).toBe(expected);
    expect(s256Challenge(attempt.verifier)).toBe(expected);
    expect(attempt.codeChallenge).toMatch(BASE64URL_43);
  });

  it('expires ten minutes after now', () => {
    const attempt = startOAuthAttempt(new SeededRandomSource(20), NOW);

    expect(attempt.expiresAt.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
    expect(OAUTH_STATE_LIFETIME_MS).toBe(10 * 60 * 1000);
  });
});

describe('encodeOAuthAttempt', () => {
  it('writes the state, the verifier and the expiry as three dot-separated parts', () => {
    const { attempt, cookie } = attemptAt();

    expect(cookie).toBe(`${attempt.state}.${attempt.verifier}.${attempt.expiresAt.getTime()}`);
    expect(cookie.split('.')).toHaveLength(3);
  });
});

describe('checkCallback on the happy path', () => {
  it('returns the code and the verifier when the state matches within ten minutes', () => {
    const { cookie, query, attempt } = attemptAt();

    const result = checkCallback(cookie, query, NOW);

    expect(result).toEqual({ ok: true, value: { code: 'auth-code-1', verifier: attempt.verifier } });
  });

  it('accepts the callback one millisecond before the attempt expires', () => {
    const { cookie, query } = attemptAt();
    const justBefore = new Date(NOW.getTime() + OAUTH_STATE_LIFETIME_MS - 1);

    expect(checkCallback(cookie, query, justBefore).ok).toBe(true);
  });
});

describe('checkCallback on the expiry boundary', () => {
  it('refuses the callback at exactly ten minutes with state-expired', () => {
    const { cookie, query } = attemptAt();
    const exactly = new Date(NOW.getTime() + OAUTH_STATE_LIFETIME_MS);

    expect(checkCallback(cookie, query, exactly)).toEqual({ ok: false, error: 'state-expired' });
  });

  it('refuses a callback long after the attempt with state-expired', () => {
    const { cookie, query } = attemptAt();
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);

    expect(checkCallback(cookie, query, later)).toEqual({ ok: false, error: 'state-expired' });
  });
});

describe('checkCallback on a state that does not match', () => {
  it('refuses a different state with state-mismatch', () => {
    const { cookie } = attemptAt();

    expect(checkCallback(cookie, { code: 'auth-code-1', state: 'not-the-state' }, NOW)).toEqual({
      ok: false,
      error: 'state-mismatch',
    });
  });

  it('refuses a state that differs only in case', () => {
    const { cookie, attempt } = attemptAt();

    expect(checkCallback(cookie, { code: 'c', state: attempt.state.toUpperCase() }, NOW)).toEqual({
      ok: false,
      error: 'state-mismatch',
    });
  });

  it('reports a mismatch before an expiry when both apply', () => {
    const { cookie } = attemptAt();
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);

    expect(checkCallback(cookie, { code: 'c', state: 'wrong' }, later)).toEqual({
      ok: false,
      error: 'state-mismatch',
    });
  });
});

describe('checkCallback without a usable state', () => {
  it('refuses a callback with no state parameter with missing-state', () => {
    const { cookie } = attemptAt();

    expect(checkCallback(cookie, { code: 'auth-code-1' }, NOW)).toEqual({
      ok: false,
      error: 'missing-state',
    });
  });

  it('refuses an empty state parameter with missing-state', () => {
    const { cookie } = attemptAt();

    expect(checkCallback(cookie, { code: 'auth-code-1', state: '' }, NOW)).toEqual({
      ok: false,
      error: 'missing-state',
    });
  });

  it('refuses a callback with no state cookie with missing-state', () => {
    const { query } = attemptAt();

    expect(checkCallback(undefined, query, NOW)).toEqual({ ok: false, error: 'missing-state' });
  });

  it('refuses an empty state cookie with missing-state', () => {
    const { query } = attemptAt();

    expect(checkCallback('', query, NOW)).toEqual({ ok: false, error: 'missing-state' });
  });

  it.each([
    ['one part', 'onlyonepart'],
    ['two parts', 'state.verifier'],
    ['four parts', 'a.b.c.123'],
    ['an empty state', '.verifier.123'],
    ['an empty verifier', 'state..123'],
    ['an expiry that is not a number', 'state.verifier.soon'],
    ['a negative expiry', 'state.verifier.-5'],
    ['a fractional expiry', 'state.verifier.1.5'],
  ])('refuses a malformed state cookie (%s) with missing-state', (_label, cookie) => {
    const query: CallbackQuery = { code: 'auth-code-1', state: 'state' };

    expect(checkCallback(cookie, query, NOW)).toEqual({ ok: false, error: 'missing-state' });
  });
});

describe('checkCallback on a provider error', () => {
  it('refuses access_denied with provider-error when the state matches', () => {
    const { cookie, attempt } = attemptAt();

    expect(checkCallback(cookie, { error: 'access_denied', state: attempt.state }, NOW)).toEqual({
      ok: false,
      error: 'provider-error',
    });
  });

  it('refuses access_denied without a state with missing-state, not provider-error', () => {
    const { cookie } = attemptAt();

    expect(checkCallback(cookie, { error: 'access_denied' }, NOW)).toEqual({
      ok: false,
      error: 'missing-state',
    });
  });

  it('refuses a callback that carries no code and no error with provider-error', () => {
    const { cookie, attempt } = attemptAt();

    expect(checkCallback(cookie, { state: attempt.state }, NOW)).toEqual({
      ok: false,
      error: 'provider-error',
    });
  });

  it('refuses an empty code with provider-error', () => {
    const { cookie, attempt } = attemptAt();

    expect(checkCallback(cookie, { code: '', state: attempt.state }, NOW)).toEqual({
      ok: false,
      error: 'provider-error',
    });
  });
});
