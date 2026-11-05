import { context } from '@opentelemetry/api';
import { traceparentOf } from '@d2rmm/telemetry';
import type { Kysely } from 'kysely';
import type { AnyDomainEvent, Clock, Outbox, Transaction } from '../../shared-kernel/index.ts';
import type { PlatformDatabase } from './database.ts';

/** Transient events are published on the bus only and never stored (shared kernel, `BusEvent`). */
const TRANSIENT_TYPES: ReadonlySet<string> = new Set(['AgentPresenceChanged', 'AgentRevoked']);

/**
 * The Kysely transaction behind an opaque `Transaction`. Only the platform's unit of work creates the token, from a
 * Kysely transaction, so the cast is sound. Module adapters repeat this cast because they may not import platform/.
 */
export function executorOf<DB>(tx: Transaction): Kysely<DB> {
  return tx as unknown as Kysely<DB>;
}

/**
 * Appends durable events to `platform.outbox` in the caller's transaction (ADR 008). The row's `created_at` comes from
 * the Clock port. The unit of work asks `appendedIn` after the commit, to decide whether to wake the relay.
 */
export class PostgresOutbox implements Outbox {
  readonly #clock: Clock;
  readonly #appendedIn = new WeakSet<Transaction>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async append(tx: Transaction, events: readonly AnyDomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    for (const event of events) {
      if (TRANSIENT_TYPES.has(event.type)) {
        throw new Error(`${event.type} is transient and is never stored in the outbox`);
      }
    }
    const createdAt = this.#clock.now();
    // Read before any await: the span of the caller is the active one here. Null when no valid span is active.
    const traceContext = traceparentOf(context.active()) ?? null;
    await executorOf<PlatformDatabase>(tx)
      .insertInto('platform.outbox')
      .values(
        events.map((event) => ({
          event_type: event.type,
          payload: JSON.stringify(event.payload),
          created_at: createdAt,
          trace_context: traceContext,
        })),
      )
      .execute();
    this.#appendedIn.add(tx);
  }

  /** True when this transaction appended at least one row. Meaningful once the transaction has finished its work. */
  appendedIn(tx: Transaction): boolean {
    return this.#appendedIn.has(tx);
  }
}
