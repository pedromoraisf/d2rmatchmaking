// `joinQueue` (QUE-01, QUE-02): the entry rules of QUE-03 … QUE-06, then the ticket, then one matcher run (QUE-11).
import { D2R_DIFFICULTY, D2R_QUEUE_MODE } from '@d2rmm/telemetry';
import { poolSizeOf } from '../domain/matcher.ts';
import { checkEntry, type EntryRefusal, type EntryRequest } from '../domain/entry-rules.ts';
import type {
  Activity,
  LevelingRole,
  PvpFormat,
  PvpRules,
  QueueDifficulty,
  QueueRegion,
  QueueTicket,
} from '../domain/queue-ticket/queue-ticket.ts';
import {
  err,
  ok,
  withRecordingSpan,
  type Clock,
  type IdGenerator,
  type QueueTicketSnapshot,
  type Result,
} from '../../../shared-kernel/index.ts';
import type { QueueNotifier } from './queue-notifier.ts';
import { snapshotOf, setAttributesOf } from './queue-view.ts';
import type {
  AccountLinkPort,
  AgentPresencePort,
  CharactersPort,
  QueueStore,
  RatingsPort,
  RoomsPort,
  SiteConnectionsPort,
} from './ports.ts';

/** The body of a join, after the contract validated it (QUE-01, QUE-02). */
export type QueueJoinInput =
  | {
      readonly mode: 'pvp';
      readonly characterId: string;
      readonly difficulty: QueueDifficulty;
      readonly region: QueueRegion;
      readonly format: PvpFormat;
      readonly rules: PvpRules;
    }
  | {
      readonly mode: 'leveling';
      readonly characterId: string;
      readonly difficulty: QueueDifficulty;
      readonly region: QueueRegion;
      readonly activity: Activity;
      readonly role: LevelingRole;
      readonly minLevel: number;
    };

/** Why a join is refused: the entry rules, the connection checks (QUE-05) and the one-ticket rule (QUE-06). */
export type JoinRefusal =
  | EntryRefusal
  | 'not-your-character'
  | 'not-linked'
  | 'agent-offline'
  | 'site-not-open'
  | 'already-queued'
  | 'in-room';

export interface JoinQueueDeps {
  readonly store: QueueStore;
  readonly characters: CharactersPort;
  readonly presence: AgentPresencePort;
  readonly links: AccountLinkPort;
  readonly sites: SiteConnectionsPort;
  readonly rooms: RoomsPort;
  readonly ratings: RatingsPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly notifier: QueueNotifier;
  /** One matcher run over the queue as it is now (`run-matcher.ts`); the caller holds the queue's lock. */
  readonly matchNow: () => Promise<void>;
}

function entryRequestOf(input: QueueJoinInput): EntryRequest {
  return input.mode === 'pvp'
    ? { mode: 'pvp', difficulty: input.difficulty }
    : {
        mode: 'leveling',
        difficulty: input.difficulty,
        activity: input.activity,
        minLevel: input.minLevel,
      };
}

/**
 * Adds a ticket when every rule passes, then runs the matcher. The answer is the ticket as it was when it joined, even when
 * the same run grouped it (the site hears of the match on its own stream). The span carries the mode, the difficulty, the
 * ladder and the era, never a name (QUE-16).
 */
export function createJoinQueue(deps: JoinQueueDeps) {
  /** The instant of the last join, in ms: each join gets a later one, so the join order is never a tie (see below). */
  let lastJoinMs = Number.NEGATIVE_INFINITY;
  return (input: {
    readonly accountId: string;
    readonly request: QueueJoinInput;
  }): Promise<Result<QueueTicketSnapshot, JoinRefusal>> =>
    withRecordingSpan(
      'matchmaking.join',
      { [D2R_QUEUE_MODE]: input.request.mode, [D2R_DIFFICULTY]: input.request.difficulty },
      async (span): Promise<Result<QueueTicketSnapshot, JoinRefusal>> => {
        const { accountId, request } = input;
        if ((await deps.store.byAccount(accountId)) !== undefined) {
          return err('already-queued');
        }
        if (await deps.rooms.hasOpenRoom(accountId)) {
          return err('in-room');
        }
        if (!(await deps.links.isLinked(accountId))) {
          return err('not-linked');
        }
        if (!(await deps.presence.isOnline(accountId))) {
          return err('agent-offline');
        }
        if (!(await deps.sites.hasSiteStream(accountId))) {
          return err('site-not-open');
        }
        const character = await deps.characters.characterOf(accountId, request.characterId);
        if (character === null) {
          return err('not-your-character');
        }
        const entry = checkEntry(character, entryRequestOf(request));
        if (!entry.ok) {
          return err(entry.error);
        }

        // A clock that stands still (the acceptance stack moves only when a scenario says so) still gives each join its own
        // instant, so the join order the matcher and the host rule read is the order the players joined (QUE-11, QUE-12).
        const at = Math.max(deps.clock.now().getTime(), lastJoinMs + 1);
        lastJoinMs = at;
        const now = new Date(at);
        const base = {
          id: deps.ids.next(),
          accountId,
          characterId: request.characterId,
          region: request.region,
          difficulty: request.difficulty,
          ladder: entry.value.ladder,
          era: entry.value.era,
          rating: await deps.ratings.ratingOf(accountId, request.characterId),
          level: character.level,
          joinedAt: now,
        };
        const ticket: QueueTicket =
          request.mode === 'pvp'
            ? { ...base, mode: 'pvp', pvp: { format: request.format, rules: request.rules } }
            : {
                ...base,
                mode: 'leveling',
                leveling: { activity: request.activity, role: request.role, minLevel: request.minLevel },
              };
        span.setAttributes(setAttributesOf(ticket));

        await deps.store.add(ticket);
        const queued = await deps.store.all();
        const answer = snapshotOf(ticket, now, poolSizeOf(ticket, queued));
        await deps.notifier.waiting(ticket, now, answer.poolSize);
        deps.notifier.sizes(queued);
        await deps.matchNow();
        return ok(answer);
      },
    );
}
