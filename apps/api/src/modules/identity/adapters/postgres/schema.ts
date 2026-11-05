/** The Identity module's tables (design.md § Data Models). Owned by this module; no other module reads them. */
export interface IdentityDatabase {
  'identity.accounts': {
    id: string;
    battletag: string;
    display_name: string;
    test_key: string | null;
    created_at: Date;
  };
  'identity.sessions': {
    token_hash: string;
    account_id: string;
    expires_at: Date;
  };
}
