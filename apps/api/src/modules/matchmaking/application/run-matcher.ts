// The matcher run (QUE-11, QUE-12): forms the groups the pool holds now, in one unit of work writes `MatchFormed` to the
// outbox and takes the grouped tickets out of the queue, then tells the sites.
import { formGroups, type FormedGroup } from '../domain/matcher.ts';
import {
  withSpan,
  type Clock,
  type IdGenerator,
  type MatchFormedEvent,
  type Outbox,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import type { QueueNotifier } from './queue-notifier.ts';
import type { QueueStore } from './ports.ts';

export interface RunMatcherDeps {
  readonly store: QueueStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly notifier: QueueNotifier;
}

/** The `MatchFormed` event of one group: members in join order, the host as `role: host` (QUE-12). */
export function matchFormedEvent(group: FormedGroup, matchId: string): MatchFormedEvent {
  return {
    type: 'MatchFormed',
    payload: {
      matchId,
      mode: group.mode,
      activity: group.activity,
      difficulty: group.difficulty,
      region: group.region,
      ladder: group.ladder,
      era: group.era,
      members: group.members.map((member, index) => ({
        accountId: member.accountId,
        characterId: member.characterId,
        joinOrder: index + 1,
        role: member.id === group.hostTicketId ? 'host' : 'member',
      })),
    },
  };
}

/**
 * Runs the matcher once over the queue as it is now. Callers hold the queue's serial lock (`queue-use-cases.ts`), so the
 * tickets read here are the tickets removed here.
 */
export function createMatchNow(deps: RunMatcherDeps): () => Promise<void> {
  return () =>
    withSpan('matchmaking.match', {}, async (): Promise<void> => {
      const now = deps.clock.now();
      const tickets = await deps.store.all();
      const { groups, remaining } = formGroups(tickets, now);
      if (groups.length > 0) {
        const events = groups.map((group) => matchFormedEvent(group, deps.ids.next()));
        const grouped = groups.flatMap((group) => group.members.map((member) => member.id));
        await deps.uow.run(async (tx) => {
          await deps.outbox.append(tx, events);
          await deps.store.remove(grouped);
        });
        for (const group of groups) {
          for (const member of group.members) {
            deps.notifier.waitedAtMatch(member, now);
            await deps.notifier.left(member, 'matched');
          }
        }
      }
      await deps.notifier.refresh(remaining, now);
      deps.notifier.sizes(remaining);
    });
}
