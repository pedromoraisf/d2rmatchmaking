import type { RandomSource } from '../../../shared-kernel/index.ts';

const SESSION_TOKEN_PREFIX = 'd2rmm_s_';

/** `d2rmm_s_` followed by 32 random bytes in base64url (43 characters). */
export function newSessionToken(random: RandomSource): string {
  return `${SESSION_TOKEN_PREFIX}${Buffer.from(random.bytes(32)).toString('base64url')}`;
}

/** A session token has the prefix and a body; anything else is refused before any lookup. */
export function hasSessionTokenShape(token: string): boolean {
  return token.startsWith(SESSION_TOKEN_PREFIX) && token.length > SESSION_TOKEN_PREFIX.length;
}
