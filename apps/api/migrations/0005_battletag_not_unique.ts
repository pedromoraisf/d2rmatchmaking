// A BattleTag is not an identity: the player can change it, and a freed one can be taken by another Battle.net account
// (IDB-02, IDB-03). The unique constraint of 0001 on `battletag` is dropped. Test accounts stay unique by their key, so
// a unique index on `test_key` where it is set is added (IDB-07). Additive for Battle.net accounts; never edits 0001.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  'alter table identity.accounts drop constraint accounts_battletag_key',
  'create unique index accounts_test_key_present on identity.accounts (test_key) where test_key is not null',
];

const DOWN_STATEMENTS: readonly string[] = [
  'drop index identity.accounts_test_key_present',
  'alter table identity.accounts add constraint accounts_battletag_key unique (battletag)',
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
