// The limits that keep the matcher's cost bounded (QUE-18, QUE-19). Pure: the caller passes the timestamps and `now`.
import { SlidingWindowLimit } from '../../../shared-kernel/sliding-window.ts';

const MS_PER_MINUTE = 60 * 1000;

/** Joins per account: 10 in any minute (QUE-18). Every attempt counts, whatever its answer. */
export const JOIN_LIMIT = new SlidingWindowLimit(10, MS_PER_MINUTE);

/** Waiting tickets per pool (QUE-07 filters): a join into a pool that holds this many is refused (QUE-19). */
export const MAX_POOL_TICKETS = 2000;
