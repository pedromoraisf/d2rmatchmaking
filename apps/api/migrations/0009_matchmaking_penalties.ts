// The Matchmaking schema and its penalties (RDY-05, RDY-09, design.md § Data Models): a player who did not answer a ready
// check waits five minutes, and the wait survives a restart. One row per account; a new penalty replaces the row.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  'create schema matchmaking',
  `create table matchmaking.penalties (
    account_id uuid primary key,
    reason text not null,
    until timestamptz not null
  )`,
];

const DOWN_STATEMENTS: readonly string[] = ['drop table matchmaking.penalties', 'drop schema matchmaking'];

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
