// `joinQueue` (QUE-01, QUE-02): the joins-per-minute limit (QUE-18), the entry rules of QUE-03 … QUE-06, the pool cap
// (QUE-19), then the ticket, then one matcher run (QUE-11).
import { D2R_DIFFICULTY, D2R_QUEUE_MODE } from '@d2rmm/telemetry';
import { poolSizeOf } from '../domain/matcher.ts';
import { JOIN_LIMIT, MAX_POOL_TICKETS } from '../domain/queue-limits.ts';
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
  JoinLimitStore,
  PenaltyStore,
  QueueStore,
  RatingsPort,
  ReadyCheckStore,
  RoomsPort,
  SiteConnectionsPort,
} from './ports.ts';
import { isPenalized, penaltySecondsLeft } from '../domain/ready-check/penalty.ts';

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

/**
 * Why a join is refused: the joins limit (QUE-18), the entry rules, the connection checks (QUE-05), the one-ticket rule
 * (QUE-06) and the pool cap (QUE-19).
 */
export type JoinRefusal =
  | EntryRefusal
  | 'too-many-joins'
  | 'not-your-character'
  | 'not-linked'
  | 'agent-offline'
  | 'site-not-open'
  | 'already-queued'
  | 'in-room'
  | 'queue-full';

/** The refusal of a join by a ready-check penalty: the reason and the whole seconds left (RDY-05). */
export interface PenaltyRefusal {
  readonly error: 'ready-check-penalty';
  readonly secondsLeft: number;
}

export interface JoinQueueDeps {
  readonly store: QueueStore;
  readonly checks: ReadyCheckStore;
  readonly penalties: PenaltyStore;
  readonly joinLimits: JoinLimitStore;
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
 * ladder and the era, never a name (QUE-16). A refused join changes nothing in the queue and takes no id or join instant.
 */
export function createJoinQueue(deps: JoinQueueDeps) {
  /** The instant of the last join, in ms: each join gets a later one, so the join order is never a tie (see below). */
  let lastJoinMs = Number.NEGATIVE_INFINITY;
  return (input: {
    readonly accountId: string;
    readonly request: QueueJoinInput;
  }): Promise<Result<QueueTicketSnapshot, JoinRefusal | PenaltyRefusal>> =>
    withRecordingSpan(
      'matchmaking.join',
      { [D2R_QUEUE_MODE]: input.request.mode, [D2R_DIFFICULTY]: input.request.difficulty },
      async (span): Promise<Result<QueueTicketSnapshot, JoinRefusal | PenaltyRefusal>> => {
        const { accountId, request } = input;
        // Every attempt counts toward the limit, whatever it answers (QUE-18); a refused attempt records nothing.
        const attempted = deps.clock.now();
        const attempts = await deps.joinLimits.timestamps(accountId);
        if (JOIN_LIMIT.check(attempts, attempted).outcome === 'limited') {
          return err('too-many-joins');
        }
        await deps.joinLimits.record(accountId, attempted);
        if ((await deps.store.byAccount(accountId)) !== undefined) {
          return err('already-queued');
        }
        // A member of an open ready check is in a group already: no second ticket while the check is open (INV-04).
        if ((await deps.checks.openOf(accountId)) !== undefined) {
          return err('already-queued');
        }
        if (await deps.rooms.hasOpenRoom(accountId)) {
          return err('in-room');
        }
        // A player who did not answer a ready check waits five minutes (RDY-05), with the whole seconds left shown.
        const penalty = await deps.penalties.untilOf(accountId);
        if (penalty !== undefined && isPenalized(penalty, attempted)) {
          return err({
            error: 'ready-check-penalty',
            secondsLeft: penaltySecondsLeft(penalty, attempted),
          });
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
        const at = Math.max(attempted.getTime(), lastJoinMs + 1);
        const now = new Date(at);
        const base = {
          accountId,
          characterId: request.characterId,
          characterClass: character.characterClass,
          region: request.region,
          difficulty: request.difficulty,
          ladder: entry.value.ladder,
          era: entry.value.era,
          rating: await deps.ratings.ratingOf(accountId, request.characterId),
          level: character.level,
          joinedAt: now,
        };
        const withId = (id: string): QueueTicket =>
          request.mode === 'pvp'
            ? { ...base, id, mode: 'pvp', pvp: { format: request.format, rules: request.rules } }
            : {
                ...base,
                id,
                mode: 'leveling',
                leveling: { activity: request.activity, role: request.role, minLevel: request.minLevel },
              };

        // The pool cap (QUE-19) is read before the ticket takes an id: a refused join leaves no trace.
        const queued = await deps.store.all();
        if (poolSizeOf(withId(''), queued) >= MAX_POOL_TICKETS) {
          return err('queue-full');
        }
        lastJoinMs = at;
        const ticket = withId(deps.ids.next());
        span.setAttributes(setAttributesOf(ticket));

        await deps.store.add(ticket);
        const afterJoin = await deps.store.all();
        const answer = snapshotOf(ticket, now, poolSizeOf(ticket, afterJoin));
        await deps.notifier.waiting(ticket, now, answer.poolSize);
        deps.notifier.sizes(afterJoin);
        await deps.matchNow();
        return ok(answer);
      },
    );
}
