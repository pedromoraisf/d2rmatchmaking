import type { Cancel } from '../../../shared-kernel/index.ts';

/**
 * The pending deadline of each open ready check. An entry lives only while its check is open: `release` cancels the
 * deadline and drops the entry, so `pending()` is the number of checks still waiting for their deadline.
 */
export function createDeadlineRegistry() {
  const cancels = new Map<string, Cancel>();
  return {
    hold(checkId: string, cancel: Cancel): void {
      cancels.set(checkId, cancel);
    },
    release(checkId: string): void {
      cancels.get(checkId)?.();
      cancels.delete(checkId);
    },
    pending: (): number => cancels.size,
  };
}
