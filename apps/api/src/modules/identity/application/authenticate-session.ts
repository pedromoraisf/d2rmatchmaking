import { Session } from '../domain/session.ts';
import { err, ok, withSpan, type Clock, type Result } from '../../../shared-kernel/index.ts';
import type { SecretHasher, SessionRepository } from './ports.ts';
import { hasSessionTokenShape } from './session-token.ts';

export interface AuthenticateSessionDeps {
  readonly sessions: SessionRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
}

export interface AuthenticatedSession {
  readonly accountId: string;
  readonly expiresAt: Date;
}

/** Resolves a session token to its account. Unknown, malformed and expired tokens are `unauthenticated`. */
export function createAuthenticateSession(deps: AuthenticateSessionDeps) {
  return (token: string): Promise<Result<AuthenticatedSession, 'unauthenticated'>> =>
    withSpan(
      'identity.authenticate-session',
      {},
      async (): Promise<Result<AuthenticatedSession, 'unauthenticated'>> => {
        if (!hasSessionTokenShape(token)) {
          return err('unauthenticated');
        }
        const record = await deps.sessions.findByHash(deps.hasher.hash('session', token));
        if (record === null) {
          return err('unauthenticated');
        }
        const session = new Session(record.accountId, record.expiresAt);
        if (!session.isValidAt(deps.clock.now())) {
          return err('unauthenticated');
        }
        return ok({ accountId: session.accountId, expiresAt: session.expiresAt });
      },
    );
}
