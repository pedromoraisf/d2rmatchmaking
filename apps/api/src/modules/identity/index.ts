import type { Result } from '../../shared-kernel/index.ts';

export { createIdentityUseCases } from './application/identity-use-cases.ts';
export type { IdentityDeps, IdentityUseCases } from './application/identity-use-cases.ts';
export type { AccountRepository, SecretHasher, SessionRepository } from './application/ports.ts';

/** The Identity module's public port, used by the platform guards and other modules (design.md § Identity module). */
export interface IdentityPort {
  authenticateSession(
    token: string,
  ): Promise<Result<{ accountId: string; expiresAt: Date }, 'unauthenticated'>>;
}
