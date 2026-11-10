// The characters the agent read on the character selection screen (CHR-09, design.md § Identity module). A character is
// keyed by its account and its name: a newer reading replaces the fields of the row (unique (account_id, name)). The row
// lives with its account and holds no secret.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  `create table identity.characters (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references identity.accounts,
    name text not null,
    class text not null,
    level int not null,
    ladder text not null,
    era text not null,
    unlocked_difficulties text[] not null,
    read_at timestamptz not null,
    unique (account_id, name)
  )`,
];

const DOWN_STATEMENTS: readonly string[] = ['drop table identity.characters'];

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
