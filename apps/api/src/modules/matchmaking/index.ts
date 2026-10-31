import { createFormTestMatch, type FormTestMatchDeps } from './application/form-test-match.ts';

export type { FormTestMatchDeps } from './application/form-test-match.ts';

/** Builds the Matchmaking use cases over their ports (design.md § Matchmaking module). */
export function createMatchmakingUseCases(deps: FormTestMatchDeps) {
  return { formTestMatch: createFormTestMatch(deps) };
}

export type MatchmakingUseCases = ReturnType<typeof createMatchmakingUseCases>;
