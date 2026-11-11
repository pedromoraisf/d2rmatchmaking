// The matcher run (QUE-11, QUE-12): forms the groups the pool holds now, takes their tickets out of the queue and opens a
// ready check for each group (RDY-01). `MatchFormed` is written later, when every member has accepted (RDY-03).
import { formGroups, type FormedGroup } from '../domain/matcher.ts';
import { withSpan, type Clock } from '../../../shared-kernel/index.ts';
import type { QueueNotifier } from './queue-notifier.ts';
import type { QueueStore } from './ports.ts';

export { matchFormedEvent, teamOfMember } from './match-formed.ts';

/** Opens the ready check of a formed group (RDY-01). The caller holds the queue's lock. */
export interface ReadyCheckOpener {
  open(group: FormedGroup, now: Date): Promise<void>;
}

export interface RunMatcherDeps {
  readonly store: QueueStore;
  readonly clock: Clock;
  readonly notifier: QueueNotifier;
  readonly readyChecks: ReadyCheckOpener;
}

/**
 * Runs the matcher once over the queue as it is now. Callers hold the queue's serial lock (`queue-use-cases.ts`), so the
 * tickets read here are the tickets removed here.
 */
export function createMatchNow(deps: RunMatcherDeps): () => Promise<void> {
  return async (): Promise<void> => {
    // An idle tick, with nobody queued, records nothing: no span and no metric (the matcher runs every second).
    const queued = await deps.store.all();
    if (queued.length === 0) {
      return;
    }
    await withSpan('matchmaking.match', {}, async (): Promise<void> => {
      const now = deps.clock.now();
      const { groups, remaining } = formGroups(queued, now);
      if (groups.length > 0) {
        await deps.store.remove(groups.flatMap((group) => group.members.map((member) => member.id)));
        for (const group of groups) {
          for (const member of group.members) {
            deps.notifier.waitedAtMatch(member, now);
            await deps.notifier.left(member, 'matched');
          }
          await deps.readyChecks.open(group, now);
        }
      }
      await deps.notifier.refresh(remaining, now);
      deps.notifier.sizes(remaining);
    });
  };
}
