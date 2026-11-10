// The pure rules of the Battle.net sign-in round trip (IDB-01, IDB-04): the state, the PKCE pair and the one cookie that
// binds them to the browser. Nothing is stored on the server, so an API restart does not break a sign-in in flight.
import { createHash } from 'node:crypto';
import { err, ok, type RandomSource, type Result } from '../../../shared-kernel/index.ts';

/** A sign-in in flight stays valid for ten minutes (IDB-01). */
export const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;

/** The random `state` and PKCE verifier of one sign-in attempt, with the S256 challenge sent to Battle.net. */
export interface OAuthAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly codeChallenge: string;
  readonly expiresAt: Date;
}

/** The query parameters Battle.net sends back to the callback. Every one is optional: the callback checks them. */
export interface CallbackQuery {
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
}

export type CallbackFailure = 'missing-state' | 'state-mismatch' | 'state-expired' | 'provider-error';

/** A 32-byte value in base64url: 43 characters, the RFC 7636 verifier length. */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** The S256 code challenge of a verifier: base64url of its SHA-256 (RFC 7636 § 4.2). */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** A new attempt: a random state and verifier from the injected source, expiring ten minutes after `now`. */
export function startOAuthAttempt(random: RandomSource, now: Date): OAuthAttempt {
  const state = base64url(random.bytes(32));
  const verifier = base64url(random.bytes(32));
  return {
    state,
    verifier,
    codeChallenge: s256Challenge(verifier),
    expiresAt: new Date(now.getTime() + OAUTH_STATE_LIFETIME_MS),
  };
}

/**
 * The cookie value of an attempt: `<state>.<verifier>.<expiry in epoch ms>`. base64url has no dot, so the value splits
 * back into exactly three parts.
 */
export function encodeOAuthAttempt(attempt: OAuthAttempt): string {
  return `${attempt.state}.${attempt.verifier}.${attempt.expiresAt.getTime()}`;
}

interface DecodedAttempt {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAtMs: number;
}

/** The attempt of a cookie value, or undefined when the value is absent or not one this module wrote. */
function decode(cookieValue: string | undefined): DecodedAttempt | undefined {
  if (cookieValue === undefined) {
    return undefined;
  }
  const parts = cookieValue.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  const [state, verifier, expiry] = parts;
  if (state === undefined || verifier === undefined || expiry === undefined) {
    return undefined;
  }
  if (state === '' || verifier === '' || !/^\d+$/.test(expiry)) {
    return undefined;
  }
  return { state, verifier, expiresAtMs: Number(expiry) };
}

/**
 * Checks the callback against the browser's cookie. Checks run in this order: a missing or malformed cookie, a missing
 * or different `state`, an attempt at or past its expiry (a `state` is valid strictly before ten minutes), then the
 * provider's `error` and a missing `code`. Success returns the code and the verifier for the token exchange.
 */
export function checkCallback(
  cookieValue: string | undefined,
  query: CallbackQuery,
  now: Date,
): Result<{ readonly code: string; readonly verifier: string }, CallbackFailure> {
  const attempt = decode(cookieValue);
  if (attempt === undefined || query.state === undefined || query.state === '') {
    return err('missing-state');
  }
  if (query.state !== attempt.state) {
    return err('state-mismatch');
  }
  if (now.getTime() >= attempt.expiresAtMs) {
    return err('state-expired');
  }
  if (query.error !== undefined) {
    return err('provider-error');
  }
  if (query.code === undefined || query.code === '') {
    return err('provider-error');
  }
  return ok({ code: query.code, verifier: attempt.verifier });
}
