import { createFormTestMatch, type FormTestMatchDeps } from './application/form-test-match.ts';

export type { FormTestMatchDeps } from './application/form-test-match.ts';
export { createQueueUseCases } from './application/queue-use-cases.ts';
export type { QueueUseCaseDeps, QueueUseCases } from './application/queue-use-cases.ts';
export type {
  AccountLinkPort,
  AgentPresencePort,
  CharactersPort,
  QueueAttributes,
  QueueMetrics,
  QueueStore,
  RatingsPort,
  RoomsPort,
  SiteConnectionsPort,
} from './application/ports.ts';
export type { JoinRefusal, QueueJoinInput } from './application/join-queue.ts';
export type { DropReason } from './application/leave-queue.ts';

/** Builds the Matchmaking use cases over their ports (design.md § Matchmaking module). */
export function createMatchmakingUseCases(deps: FormTestMatchDeps) {
  return { formTestMatch: createFormTestMatch(deps) };
}

export type MatchmakingUseCases = ReturnType<typeof createMatchmakingUseCases>;
