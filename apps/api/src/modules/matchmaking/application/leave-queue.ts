// `leaveQueue` (QUE-13) and `dropTicket` (QUE-14): the two ways a ticket leaves the queue without a match.
import {
  err,
  ok,
  withRecordingSpan,
  type QueueLeaveReason,
  type Result,
} from '../../../shared-kernel/index.ts';
import type { QueueNotifier } from './queue-notifier.ts';
import { setAttributesOf } from './queue-view.ts';
import type { QueueStore } from './ports.ts';

export interface LeaveQueueDeps {
  readonly store: QueueStore;
  readonly notifier: QueueNotifier;
}

/** The player leaves their own ticket. A ticket that is not theirs answers not-found (QUE-13). */
export function createLeaveQueue(deps: LeaveQueueDeps) {
  return (input: {
    readonly accountId: string;
    readonly ticketId: string;
  }): Promise<Result<void, 'not-found'>> =>
    withRecordingSpan('matchmaking.leave', {}, async (span): Promise<Result<void, 'not-found'>> => {
      const ticket = await deps.store.find(input.ticketId);
      if (ticket === undefined || ticket.accountId !== input.accountId) {
        return err('not-found');
      }
      span.setAttributes(setAttributesOf(ticket));
      await deps.store.remove([ticket.id]);
      await deps.notifier.left(ticket, 'left-by-player');
      deps.notifier.sizes(await deps.store.all());
      return ok(undefined);
    });
}

/** The reasons a ticket is dropped by the platform's subscribers (QUE-14). */
export type DropReason = Exclude<QueueLeaveReason, 'left-by-player' | 'matched'>;

export interface DropTicketDeps {
  readonly store: QueueStore;
  readonly notifier: QueueNotifier;
}

/** Removes the account's ticket, if it has one, and tells the site why (QUE-14). A missing ticket is not an error. */
export function createDropTicket(deps: DropTicketDeps) {
  return async (input: { readonly accountId: string; readonly reason: DropReason }): Promise<void> => {
    const ticket = await deps.store.byAccount(input.accountId);
    if (ticket === undefined) {
      return;
    }
    await deps.store.remove([ticket.id]);
    await deps.notifier.left(ticket, input.reason);
    deps.notifier.sizes(await deps.store.all());
  };
}
