// The W3C traceparent of the span that appended an outbox row (OBS-05). Nullable: rows written before this migration,
// and rows appended with no active span, carry none, and the relay publishes them as root spans (OBS-07).
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table platform.outbox add column trace_context text null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table platform.outbox drop column trace_context`.execute(db);
}
