// What the queue tells the site and the metrics (QUE-14, QUE-15, QUE-16). Transient `QueueUpdated` events go to the bus
// only; the site stream turns them into `queue.updated` (the stream projection, platform).
import { poolCounts } from '../domain/matcher.ts';
import { poolKey, type QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';
import type { EventBus, QueueLeaveReason, QueueTicketSnapshot } from '../../../shared-kernel/index.ts';
import { attributeKey, attributesOf, snapshotOf } from './queue-view.ts';
import type { QueueAttributes, QueueMetrics } from './ports.ts';

export interface QueueNotifier {
  /** The ticket is waiting: the site shows its view at once (QUE-15). */
  waiting(ticket: QueueTicket, now: Date, poolSize: number): Promise<void>;
  /** Tells the site of each remaining ticket whose band or pool size changed since it was last told. */
  refresh(remaining: readonly QueueTicket[], now: Date): Promise<void>;
  /** The ticket left the queue, for `reason` (QUE-13, QUE-14, QUE-12). */
  left(ticket: QueueTicket, reason: QueueLeaveReason): Promise<void>;
  /** The waiting count of every pool that has held a ticket, after a change (`d2r.queue.size`). */
  sizes(tickets: readonly QueueTicket[]): void;
  /** The ticket left in a match after the wait `now - joinedAt` (`d2r.queue.wait`). */
  waitedAtMatch(ticket: QueueTicket, now: Date): void;
}

export interface QueueNotifierDeps {
  readonly bus: EventBus;
  readonly metrics: QueueMetrics;
}

export function createQueueNotifier(deps: QueueNotifierDeps): QueueNotifier {
  /** The signature of the last view each waiting ticket was told, so unchanged views are not sent again. */
  const told = new Map<string, string>();
  /** Every pool that has held a ticket, so a pool that empties is reported as 0. */
  const knownPools = new Map<string, QueueAttributes>();

  const publish = (
    accountId: string,
    update: QueueTicketSnapshot | { status: 'left'; reason: QueueLeaveReason },
  ) =>
    deps.bus.publish({
      kind: 'transient',
      event: { type: 'QueueUpdated', payload: { accountId, update } },
    });

  const signatureOf = (snapshot: QueueTicketSnapshot): string =>
    JSON.stringify({ band: snapshot.band, poolSize: snapshot.poolSize });

  return {
    async waiting(ticket, now, poolSize) {
      const snapshot = snapshotOf(ticket, now, poolSize);
      told.set(ticket.id, signatureOf(snapshot));
      await publish(ticket.accountId, snapshot);
    },

    async refresh(remaining, now) {
      const remainingIds = new Set(remaining.map((ticket) => ticket.id));
      for (const id of [...told.keys()]) {
        if (!remainingIds.has(id)) {
          told.delete(id);
        }
      }
      // Every pool's size is counted once for the whole tick, not once per ticket.
      const counts = poolCounts(remaining);
      for (const ticket of remaining) {
        const snapshot = snapshotOf(ticket, now, counts.get(poolKey(ticket)) ?? 0);
        const signature = signatureOf(snapshot);
        if (told.get(ticket.id) !== signature) {
          told.set(ticket.id, signature);
          await publish(ticket.accountId, snapshot);
        }
      }
    },

    async left(ticket, reason) {
      told.delete(ticket.id);
      await publish(ticket.accountId, { status: 'left', reason });
    },

    sizes(tickets) {
      const counts = new Map<string, number>();
      for (const ticket of tickets) {
        const attributes = attributesOf(ticket);
        const key = attributeKey(attributes);
        knownPools.set(key, attributes);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, attributes] of knownPools) {
        deps.metrics.queueSize(attributes, counts.get(key) ?? 0);
      }
    },

    waitedAtMatch(ticket, now) {
      const seconds = Math.max(0, now.getTime() - ticket.joinedAt.getTime()) / 1000;
      deps.metrics.waitAtMatch(attributesOf(ticket), seconds);
    },
  };
}
