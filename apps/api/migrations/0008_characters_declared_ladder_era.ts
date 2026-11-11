// Ladder and era are declared by the player on the site, because the selection screen shows neither (CHR-15). A reading
// now carries `hardcore`; the declared `ladder` and `era` start null and a reading never changes them. Rows that migration
// 0006 wrote with a combined ladder value keep what they held: the mode moves to `hardcore`, the flag to `ladder`.
import { type Kysely, sql } from 'kysely';

const UP_STATEMENTS: readonly string[] = [
  `alter table identity.characters add column hardcore boolean not null default false`,
  `update identity.characters
    set hardcore = ladder like 'hc-%',
        ladder = case when ladder like '%nonladder' then 'non-ladder' else 'ladder' end`,
  `alter table identity.characters alter column ladder drop not null`,
  `alter table identity.characters alter column era drop not null`,
  `alter table identity.characters add constraint characters_ladder_check check (ladder in ('ladder', 'non-ladder'))`,
];

// Rolling back restores the combined ladder value. A character not yet declared has no era to restore: it gets `lod`,
// the era most characters were created in, so the NOT NULL columns of migration 0006 hold again.
const DOWN_STATEMENTS: readonly string[] = [
  `alter table identity.characters drop constraint characters_ladder_check`,
  `update identity.characters
    set ladder = (case when hardcore then 'hc-' else 'sc-' end)
                 || (case when ladder = 'non-ladder' then 'nonladder' else 'ladder' end),
        era = coalesce(era, 'lod')`,
  `alter table identity.characters alter column ladder set not null`,
  `alter table identity.characters alter column era set not null`,
  `alter table identity.characters drop column hardcore`,
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
