import type { ColumnType, Generated } from 'kysely';

/** `platform.outbox` (design.md § Data Models). `id` is a bigserial: pg returns it as a string. */
export interface OutboxTable {
  id: Generated<string>;
  event_type: string;
  /** Written as JSON text; read back parsed (jsonb). */
  payload: ColumnType<unknown, string, never>;
  created_at: Date;
  published_at: Date | null;
  attempts: Generated<number>;
  failed_at: Date | null;
}

/** The platform's tables. Each module declares its own tables in its adapters (no shared database type). */
export interface PlatformDatabase {
  'platform.outbox': OutboxTable;
}
