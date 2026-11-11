/** The Lobby Room module's tables (design.md § Data Models). Account ids are referenced by value only (ADR 002). */
export interface LobbyDatabase {
  'lobby.rooms': {
    id: string;
    match_id: string;
    mode: 'pvp' | 'leveling';
    activity: string;
    difficulty: 'normal' | 'nightmare' | 'hell';
    host_account_id: string;
    stage: 'formed' | 'awaiting_host' | 'created' | 'active' | 'closed' | 'expired';
    current_run: number;
    created_at: Date;
    /** The W3C traceparent of the match that opened the room; null when none was active (RTL-01, RTL-02). */
    trace_context: string | null;
    /** When the room entered `awaiting_host` for its current run; the 3 minutes of INV-07 count from it. */
    awaiting_since: Date | null;
    /** When the room became `closed` or `expired`. */
    closed_at: Date | null;
  };
  'lobby.members': {
    room_id: string;
    account_id: string;
    character_id: string | null;
    role: 'host' | 'member';
    join_order: number;
    /** The run this member's agent confirmed (INV-06); null before any confirmation. */
    confirmed_run: number | null;
    /** When the member left the room (FR-32); null while they are in it. */
    left_at: Date | null;
  };
  'lobby.runs': {
    room_id: string;
    number: number;
    game_name: string;
    opened_at: Date;
  };
  'lobby.observations': {
    agent_id: string;
    idempotency_key: string;
    room_id: string;
    type: string;
    run: number;
    value: string;
    confidence: number;
    captured_at: Date;
    received_at: Date;
  };
}
