// The W3C traceparent of the match that opened the room (RTL-08). Nullable: a room opened before this migration, or while
// no span was active, has none, and reads as having none (RTL-02, RTL-04). The value lives and goes with its room.
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table lobby.rooms add column trace_context text null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table lobby.rooms drop column trace_context`.execute(db);
}
