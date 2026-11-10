import { withSpan } from '../../../shared-kernel/index.ts';
import type { SecretHasher, SessionRepository } from './ports.ts';

export interface SignOutDeps {
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
}

/**
 * Deletes the session of a token. The token is hashed like every session token, so the stored row goes and the old
 * token answers `unauthenticated` from then on (IDB-05). A token with no session deletes nothing.
 */
export function createSignOut(deps: SignOutDeps) {
  return (input: { readonly sessionToken: string }): Promise<void> =>
    withSpan('identity.sign-out-session', {}, async (): Promise<void> => {
      await deps.sessions.delete(deps.hasher.hash('session', input.sessionToken));
    });
}
