// The span attributes a use case sets once it knows an id of the player's journey (ADR 037, OBT-03). Pure builders: they
// return only the attributes whose value is known, so a use case calls one with whatever it holds. Ids and bounded game
// data only; names go through the `SpanDetail` port and only in the full tier (OBT-04).
import {
  D2R_ACCOUNT_ID,
  D2R_AGENT_ID,
  D2R_DIFFICULTY,
  D2R_GAME_NAME,
  D2R_QUEUE_MODE,
  D2R_READY_CHECK_ID,
  D2R_ROOM_ID,
  D2R_ROOM_STAGE,
  D2R_RUN_ID,
  D2R_TICKET_ID,
} from '@d2rmm/telemetry';
import type { SpanAttributes } from './tracing.ts';

export interface JourneyIds {
  readonly accountId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly roomId?: string | undefined;
  readonly runId?: string | undefined;
  readonly ticketId?: string | undefined;
  readonly readyCheckId?: string | undefined;
}

export interface GameFacts {
  readonly gameName?: string | undefined;
  readonly difficulty?: string | number | undefined;
  readonly mode?: string | undefined;
  readonly stage?: string | undefined;
}

function present(entries: ReadonlyArray<readonly [string, string | number | undefined]>): SpanAttributes {
  const attributes: SpanAttributes = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== '') attributes[key] = value;
  }
  return attributes;
}

/** `d2r.account.id`, `d2r.agent.id`, `d2r.room.id`, `d2r.run.id`, `d2r.ticket.id` and `d2r.ready_check.id`, as known. */
export function journeyIds(ids: JourneyIds): SpanAttributes {
  return present([
    [D2R_ACCOUNT_ID, ids.accountId],
    [D2R_AGENT_ID, ids.agentId],
    [D2R_ROOM_ID, ids.roomId],
    [D2R_RUN_ID, ids.runId],
    [D2R_TICKET_ID, ids.ticketId],
    [D2R_READY_CHECK_ID, ids.readyCheckId],
  ]);
}

/** `d2r.game.name`, `d2r.difficulty`, `d2r.queue.mode` and `d2r.room.stage`, as known. The difficulty is a number. */
export function gameFacts(facts: GameFacts): SpanAttributes {
  return present([
    [D2R_GAME_NAME, facts.gameName],
    [D2R_DIFFICULTY, facts.difficulty],
    [D2R_QUEUE_MODE, facts.mode],
    [D2R_ROOM_STAGE, facts.stage],
  ]);
}

/** The id of a run: a run has no row of its own, so it is the room's id and its number (`<room id>/<run>`). */
export function runIdOf(roomId: string, run: number): string {
  return `${roomId}/${String(run)}`;
}
