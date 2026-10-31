import type { Kysely } from 'kysely';
import type { Transaction } from '../../../../shared-kernel/index.ts';
import type { LobbyDatabase } from './schema.ts';

/**
 * The Kysely transaction behind the opaque `Transaction` the platform's unit of work opened (platform/postgres). Modules
 * may not import platform/, so the cast is repeated here; only that unit of work creates tokens.
 */
export function executorOf(tx: Transaction): Kysely<LobbyDatabase> {
  return tx as unknown as Kysely<LobbyDatabase>;
}
