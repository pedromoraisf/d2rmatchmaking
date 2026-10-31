/** The Agents module's tables (design.md § Data Models). Owned by this module. */
export interface AgentsDatabase {
  'agents.agents': {
    id: string;
    account_id: string | null;
    claim_secret_hash: string;
    token_hash: string | null;
    token_claimed_at: Date | null;
    paired_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  };
  'agents.pairing_codes': {
    agent_id: string;
    code: string;
    expires_at: Date;
    used_at: Date | null;
  };
}
