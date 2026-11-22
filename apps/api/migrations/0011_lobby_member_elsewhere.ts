// The run for which a member's agent saw the member in another game (ARL-10). Null while the member is in the room's
// game. The room's stage never depends on it. An accepted OTHER_GAME_SEEN sets it, a later GAME_NAME_SEEN clears it.
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw('alter table lobby.members add column elsewhere_run int null').execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('alter table lobby.members drop column elsewhere_run').execute(db);
}
