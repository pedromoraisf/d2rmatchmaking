// Character names are compared without case, as D2R does (CHR-10, security finding 3). The unique key moves from
// (account_id, name) to (account_id, lower(name)). A row whose name differs from a newer row only in case is the older
// reading of the same character, so it goes before the index is built; the newest reading keeps its spelling.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  `delete from identity.characters older
    using identity.characters newer
    where older.account_id = newer.account_id
      and lower(older.name) = lower(newer.name)
      and (older.read_at < newer.read_at or (older.read_at = newer.read_at and older.id < newer.id))`,
  `alter table identity.characters drop constraint characters_account_id_name_key`,
  `create unique index characters_account_id_lower_name_key on identity.characters (account_id, lower(name))`,
];

const DOWN_STATEMENTS: readonly string[] = [
  `drop index identity.characters_account_id_lower_name_key`,
  `alter table identity.characters add constraint characters_account_id_name_key unique (account_id, name)`,
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
