// The skeleton schema (design.md § Data Models). One schema per module (ADR 002); the outbox lives in `platform`.
// Each statement runs on its own: the extended protocol of `pg` does not accept several statements in one call.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  'create schema identity',
  'create schema agents',
  'create schema lobby',
  'create schema platform',

  `create table identity.accounts (
    id uuid primary key,
    battletag text not null unique,
    display_name text not null,
    test_key text unique,
    created_at timestamptz not null
  )`,
  `create table identity.sessions (
    token_hash text primary key,
    account_id uuid not null references identity.accounts,
    expires_at timestamptz not null
  )`,

  `create table agents.agents (
    id uuid primary key,
    account_id uuid references identity.accounts,
    claim_secret_hash text not null unique,
    token_hash text unique,
    token_claimed_at timestamptz,
    paired_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null
  )`,
  `create table agents.pairing_codes (
    agent_id uuid primary key references agents.agents,
    code char(6) not null,
    expires_at timestamptz not null,
    used_at timestamptz
  )`,
  'create unique index pairing_codes_live on agents.pairing_codes (code) where used_at is null',

  'create sequence lobby.game_name_seq',
  `create table lobby.rooms (
    id uuid primary key,
    match_id uuid not null unique,
    mode text not null,
    activity text not null,
    difficulty text not null,
    host_account_id uuid not null,
    stage text not null,
    current_run int not null,
    created_at timestamptz not null
  )`,
  `create table lobby.members (
    room_id uuid references lobby.rooms,
    account_id uuid not null,
    character_id uuid,
    role text not null,
    join_order int not null,
    primary key (room_id, account_id)
  )`,
  `create table lobby.runs (
    room_id uuid references lobby.rooms,
    number int not null,
    game_name text not null unique,
    opened_at timestamptz not null,
    primary key (room_id, number)
  )`,
  `create table lobby.observations (
    agent_id uuid not null,
    idempotency_key text not null,
    room_id uuid not null,
    type text not null,
    run int not null,
    value text not null,
    confidence real not null,
    captured_at timestamptz not null,
    received_at timestamptz not null,
    primary key (agent_id, idempotency_key)
  )`,

  `create table platform.outbox (
    id bigserial primary key,
    event_type text not null,
    payload jsonb not null,
    created_at timestamptz not null,
    published_at timestamptz,
    attempts int not null default 0,
    failed_at timestamptz
  )`,
  'create index outbox_pending on platform.outbox (id) where published_at is null and failed_at is null',
];

const DOWN_STATEMENTS: readonly string[] = [
  'drop schema platform cascade',
  'drop schema lobby cascade',
  'drop schema agents cascade',
  'drop schema identity cascade',
];

async function runAll(db: Kysely<unknown>, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await runAll(db, UP_STATEMENTS);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await runAll(db, DOWN_STATEMENTS);
}
