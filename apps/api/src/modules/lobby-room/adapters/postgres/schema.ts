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
  };
  'lobby.members': {
    room_id: string;
    account_id: string;
    character_id: string | null;
    role: 'host' | 'member';
    join_order: number;
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
