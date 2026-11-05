import type { Kysely } from 'kysely';
import type { Clock, Transaction } from '../../../../shared-kernel/index.ts';
import { Agent } from '../../domain/agent.ts';
import type { AgentRepository } from '../../application/ports.ts';
import { executorOf } from './executor.ts';
import type { AgentsDatabase } from './schema.ts';

type AgentRow = AgentsDatabase['agents.agents'];

function toAgent(row: AgentRow): Agent {
  return new Agent({
    id: row.id,
    claimSecretHash: row.claim_secret_hash,
    accountId: row.account_id ?? undefined,
    tokenHash: row.token_hash ?? undefined,
    tokenClaimedAt: row.token_claimed_at ?? undefined,
    pairedAt: row.paired_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  });
}

const COLUMNS = [
  'id',
  'account_id',
  'claim_secret_hash',
  'token_hash',
  'token_claimed_at',
  'paired_at',
  'revoked_at',
  'created_at',
] as const;

/** Kysely AgentRepository (design.md § Agents module). The claim is one conditional update, so two claims cannot both win. */
export class PostgresAgentRepository implements AgentRepository {
  readonly #db: Kysely<AgentsDatabase>;
  readonly #clock: Clock;

  constructor(db: Kysely<AgentsDatabase>, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async insert(tx: Transaction, agent: Agent): Promise<void> {
    await executorOf(tx)
      .insertInto('agents.agents')
      .values({
        id: agent.id,
        account_id: agent.accountId ?? null,
        claim_secret_hash: agent.claimSecretHash,
        token_hash: agent.tokenHash ?? null,
        token_claimed_at: agent.tokenClaimedAt ?? null,
        paired_at: agent.pairedAt ?? null,
        revoked_at: agent.revokedAt ?? null,
        created_at: this.#clock.now(),
      })
      .execute();
  }

  async save(tx: Transaction, agent: Agent): Promise<void> {
    await executorOf(tx)
      .updateTable('agents.agents')
      .set({
        account_id: agent.accountId ?? null,
        token_hash: agent.tokenHash ?? null,
        token_claimed_at: agent.tokenClaimedAt ?? null,
        paired_at: agent.pairedAt ?? null,
        revoked_at: agent.revokedAt ?? null,
      })
      .where('id', '=', agent.id)
      .execute();
  }

  async findById(agentId: string): Promise<Agent | null> {
    const row = await this.#db
      .selectFrom('agents.agents')
      .select(COLUMNS)
      .where('id', '=', agentId)
      .executeTakeFirst();
    return row === undefined ? null : toAgent(row);
  }

  async findByClaimSecretHash(claimSecretHash: string): Promise<Agent | null> {
    const row = await this.#db
      .selectFrom('agents.agents')
      .select(COLUMNS)
      .where('claim_secret_hash', '=', claimSecretHash)
      .executeTakeFirst();
    return row === undefined ? null : toAgent(row);
  }

  async findByTokenHash(tokenHash: string): Promise<Agent | null> {
    const row = await this.#db
      .selectFrom('agents.agents')
      .select(COLUMNS)
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row === undefined ? null : toAgent(row);
  }

  async findCurrentByAccount(accountId: string): Promise<Agent | null> {
    const row = await this.#db
      .selectFrom('agents.agents')
      .select(COLUMNS)
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row === undefined ? null : toAgent(row);
  }

  /**
   * One statement (design.md § Agents module): stores the token hash only when the agent is paired, not revoked and not
   * claimed yet. Postgres re-checks the conditions under the row lock, so of two concurrent claims only one updates a row.
   */
  async claimTokenAtomically(
    claimSecretHash: string,
    tokenHash: string,
    now: Date,
  ): Promise<{ readonly agentId: string; readonly accountId: string } | null> {
    const row = await this.#db
      .updateTable('agents.agents')
      .set({ token_hash: tokenHash, token_claimed_at: now })
      .where('claim_secret_hash', '=', claimSecretHash)
      .where('token_claimed_at', 'is', null)
      .where('account_id', 'is not', null)
      .where('revoked_at', 'is', null)
      .returning(['id', 'account_id'])
      .executeTakeFirst();
    if (row === undefined || row.account_id === null) {
      return null;
    }
    return { agentId: row.id, accountId: row.account_id };
  }
}
