// The stable Battle.net identifier of an account (IDB-02, IDB-03). Nullable: test accounts have none, and a Battle.net
// account is found by its `sub`, never by its BattleTag, which the player can change. The unique index allows many
// nulls, so only Battle.net accounts take part in it.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  'alter table identity.accounts add column bnet_sub text null',
  'create unique index accounts_bnet_sub on identity.accounts (bnet_sub)',
];

const DOWN_STATEMENTS: readonly string[] = [
  'drop index identity.accounts_bnet_sub',
  'alter table identity.accounts drop column bnet_sub',
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
