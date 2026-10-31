import type { Kysely, Transaction as KyselyTransaction } from 'kysely';
import type { AnyDomainEvent, Clock, EventBus, Scheduler } from '../shared-kernel/index.ts';
import type { PlatformDatabase } from './postgres/database.ts';

/** A row is dead-lettered after this many failed publish attempts (design.md § Platform). */
export const MAX_ATTEMPTS = 5;

/** The waits after the 1st, 2nd, 3rd and 4th failure. The 5th failure dead-letters the row instead. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000];

/** Rows locked and published per batch, in id order. */
const BATCH_SIZE = 100;

/** Wait before a drain that failed on the database itself (for example, the database is down) runs again. */
const DATABASE_RETRY_MS = 1_000;

export interface OutboxRelayDeps {
  readonly db: Kysely<PlatformDatabase>;
  readonly bus: EventBus;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  /** Called once per dead letter, after its transaction committed. Defaults to a console error with the id and type. */
  readonly onDeadLetter?: (outboxId: string, eventType: string) => void;
}

interface OutboxRow {
  readonly id: string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly attempts: number;
}

/** What a batch decided for one row. Applied in memory only after the batch transaction committed. */
type Outcome =
  | { readonly kind: 'published'; readonly id: string }
  | { readonly kind: 'retry'; readonly id: string; readonly at: number }
  | { readonly kind: 'dead'; readonly id: string; readonly eventType: string };

/**
 * Publishes the outbox to the bus (design.md § Platform). `wake()` drains the unpublished rows; `sweep()` does the same
 * from scratch at start-up. Each batch locks rows with `for update skip locked`, publishes them in id order and marks
 * them published, all in one transaction. At-least-once: a row whose handler threw is retried by a later drain.
 */
export class OutboxRelay {
  readonly #deps: OutboxRelayDeps;
  /** Earliest time a failed row is published again. In memory only: a restart forgets it and sweeps at once. */
  readonly #retryAt = new Map<string, number>();
  #again = false;
  #running: Promise<void> | undefined;

  constructor(deps: OutboxRelayDeps) {
    this.#deps = deps;
  }

  /**
   * Asks for a drain. A call made while a drain runs makes it run once more; the promise settles when no drain is
   * pending. The unit of work calls this after a commit that appended rows.
   */
  wake(): Promise<void> {
    this.#again = true;
    this.#running ??= this.#run();
    return this.#running;
  }

  /** Start-up sweep: forgets the in-memory retry times and drains every unpublished row. */
  sweep(): Promise<void> {
    this.#retryAt.clear();
    return this.wake();
  }

  /** Resolves when no drain is running. Tests use it to wait for a scheduled retry. */
  settled(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  async #run(): Promise<void> {
    try {
      do {
        this.#again = false;
        while ((await this.#batch()) > 0) {
          // Each batch publishes or defers every row it locked, so the loop ends when no row is due.
        }
      } while (this.#again);
    } catch {
      console.error('outbox relay: a drain failed on the database; retrying');
      this.#scheduleAt(this.#deps.clock.now().getTime() + DATABASE_RETRY_MS);
    } finally {
      this.#running = undefined;
    }
  }

  /** One locked batch. Returns how many rows it locked, so 0 means nothing is due. */
  async #batch(): Promise<number> {
    const nowMs = this.#deps.clock.now().getTime();
    const waiting = [...this.#retryAt].filter(([, at]) => at > nowMs).map(([id]) => id);
    const outcomes: Outcome[] = [];
    const locked = await this.#deps.db.transaction().execute(async (trx) => {
      let query = trx
        .selectFrom('platform.outbox')
        .select(['id', 'event_type', 'payload', 'attempts'])
        .where('published_at', 'is', null)
        .where('failed_at', 'is', null)
        .orderBy('id')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked();
      if (waiting.length > 0) {
        query = query.where('id', 'not in', waiting);
      }
      const rows = await query.execute();
      for (const row of rows) {
        outcomes.push(await this.#publish(trx, row));
      }
      return rows.length;
    });
    for (const outcome of outcomes) {
      this.#apply(outcome);
    }
    return locked;
  }

  /** Publishes one row and records its outcome in the batch transaction. */
  async #publish(trx: KyselyTransaction<PlatformDatabase>, row: OutboxRow): Promise<Outcome> {
    const event = { type: row.event_type, payload: row.payload } as AnyDomainEvent;
    try {
      await this.#deps.bus.publish({ kind: 'durable', id: BigInt(row.id), event });
    } catch {
      return this.#fail(trx, row);
    }
    await trx
      .updateTable('platform.outbox')
      .set({ published_at: this.#deps.clock.now() })
      .where('id', '=', row.id)
      .execute();
    return { kind: 'published', id: row.id };
  }

  async #fail(trx: KyselyTransaction<PlatformDatabase>, row: OutboxRow): Promise<Outcome> {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await trx
        .updateTable('platform.outbox')
        .set({ attempts, failed_at: this.#deps.clock.now() })
        .where('id', '=', row.id)
        .execute();
      return { kind: 'dead', id: row.id, eventType: row.event_type };
    }
    await trx.updateTable('platform.outbox').set({ attempts }).where('id', '=', row.id).execute();
    const delay = RETRY_DELAYS_MS[attempts - 1] ?? 0;
    return { kind: 'retry', id: row.id, at: this.#deps.clock.now().getTime() + delay };
  }

  #apply(outcome: Outcome): void {
    switch (outcome.kind) {
      case 'published':
        this.#retryAt.delete(outcome.id);
        return;
      case 'retry':
        this.#retryAt.set(outcome.id, outcome.at);
        this.#scheduleAt(outcome.at);
        return;
      case 'dead':
        this.#retryAt.delete(outcome.id);
        if (this.#deps.onDeadLetter === undefined) {
          console.error(
            `outbox event ${outcome.id} (${outcome.eventType}) is dead-lettered after ${MAX_ATTEMPTS} attempts`,
          );
        } else {
          this.#deps.onDeadLetter(outcome.id, outcome.eventType);
        }
        return;
    }
  }

  #scheduleAt(atMs: number): void {
    this.#deps.scheduler.at(new Date(atMs), () => {
      void this.wake();
    });
  }
}
