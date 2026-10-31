import type { Kysely } from 'kysely';
import type { Clock, Transaction } from '../../../../shared-kernel/index.ts';
import { PairingCode } from '../../domain/pairing-code.ts';
import type { PairingCodeRepository } from '../../application/ports.ts';
import { executorOf } from './executor.ts';
import type { AgentsDatabase } from './schema.ts';

type CodeRow = AgentsDatabase['agents.pairing_codes'];

function toPairingCode(row: CodeRow): PairingCode {
  return new PairingCode({
    agentId: row.agent_id,
    code: row.code,
    expiresAt: row.expires_at,
    ...(row.used_at === null ? {} : { usedAt: row.used_at }),
  });
}

/** Kysely PairingCodeRepository. Only one unused row per digits exists (partial unique index, design.md § Data Models). */
export class PostgresPairingCodeRepository implements PairingCodeRepository {
  readonly #db: Kysely<AgentsDatabase>;
  readonly #clock: Clock;

  constructor(db: Kysely<AgentsDatabase>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  /**
   * Deletes the expired unused rows with the same digits first, so the partial unique index admits the new code. A live
   * duplicate is not deleted: the insert fails and the use case draws again before it gets here.
   */
  async insert(tx: Transaction, code: PairingCode): Promise<void> {
    const executor = executorOf(tx);
    await executor
      .deleteFrom('agents.pairing_codes')
      .where('code', '=', code.code)
      .where('used_at', 'is', null)
      .where('expires_at', '<=', this.#clock.now())
      .execute();
    await executor
      .insertInto('agents.pairing_codes')
      .values({ agent_id: code.agentId, code: code.code, expires_at: code.expiresAt, used_at: null })
      .execute();
  }

  async save(tx: Transaction, code: PairingCode): Promise<void> {
    await executorOf(tx)
      .updateTable('agents.pairing_codes')
      .set({ used_at: code.usedAt ?? null })
      .where('agent_id', '=', code.agentId)
      .execute();
  }

  async findUnusedByCode(code: string): Promise<PairingCode | null> {
    const row = await this.#db
      .selectFrom('agents.pairing_codes')
      .select(['agent_id', 'code', 'expires_at', 'used_at'])
      .where('code', '=', code)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return row === undefined ? null : toPairingCode(row);
  }

  async findByAgentId(agentId: string): Promise<PairingCode | null> {
    const row = await this.#db
      .selectFrom('agents.pairing_codes')
      .select(['agent_id', 'code', 'expires_at', 'used_at'])
      .where('agent_id', '=', agentId)
      .executeTakeFirst();
    return row === undefined ? null : toPairingCode(row);
  }
}
