// The room's full stage machine (lobby-rooms): when a room entered `awaiting_host` (the 3 minutes of INV-07 count from
// it), when it ended, the run each member's agent confirmed (INV-06) and when a member left (FR-32, INV-12). A room that
// was `awaiting_host` before this migration starts its 3 minutes at its opening.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  'alter table lobby.rooms add column awaiting_since timestamptz null',
  'alter table lobby.rooms add column closed_at timestamptz null',
  "update lobby.rooms set awaiting_since = created_at where stage = 'awaiting_host'",
  'alter table lobby.members add column confirmed_run int null',
  'alter table lobby.members add column left_at timestamptz null',
];

const DOWN_STATEMENTS: readonly string[] = [
  'alter table lobby.members drop column left_at',
  'alter table lobby.members drop column confirmed_run',
  'alter table lobby.rooms drop column closed_at',
  'alter table lobby.rooms drop column awaiting_since',
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
