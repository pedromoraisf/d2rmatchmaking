/** The Matchmaking module's tables (design.md § Data Models). Account ids are referenced by value only (ADR 002). */
export interface MatchmakingDatabase {
  'matchmaking.penalties': {
    account_id: string;
    reason: 'ready-check-timeout';
    until: Date;
  };
}
