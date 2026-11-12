// The site's view of a waiting ticket (contract `QueueTicketView`) and the metric attributes of a ticket (QUE-15, QUE-16).
import { D2R_DIFFICULTY, D2R_ERA, D2R_LADDER, D2R_QUEUE_MODE } from '@d2rmm/telemetry';
import { bandAt } from '../domain/band.ts';
import { isPvpTicket, type QueueTicket } from '../domain/queue-ticket/queue-ticket.ts';
import type { QueueOptionsSnapshot, QueueTicketSnapshot } from '../../../shared-kernel/index.ts';
import type { QueueAttributes } from './ports.ts';

/** The options a ticket was joined with, in the contract's shape. */
export function optionsOf(ticket: QueueTicket): QueueOptionsSnapshot {
  const common = { characterId: ticket.characterId, difficulty: ticket.difficulty, region: ticket.region };
  return isPvpTicket(ticket)
    ? { mode: 'pvp', ...common, format: ticket.pvp.format, rules: ticket.pvp.rules }
    : {
        mode: 'leveling',
        ...common,
        activity: ticket.leveling.activity,
        role: ticket.leveling.role,
        minLevel: ticket.leveling.minLevel,
      };
}

/**
 * The waiting view of a ticket at `now`. `poolSize` counts the compatible tickets that wait, the ticket included, and never
 * shows who they are (spec decisions).
 */
export function snapshotOf(ticket: QueueTicket, now: Date, poolSize: number): QueueTicketSnapshot {
  return {
    id: ticket.id,
    status: 'waiting',
    mode: ticket.mode,
    options: optionsOf(ticket),
    joinedAt: ticket.joinedAt.toISOString(),
    band: isPvpTicket(ticket) ? bandAt(ticket.rating, ticket.joinedAt, now) : null,
    poolSize,
  };
}

/** The bounded metric and span attributes of a ticket's pool (QUE-16). */
export function attributesOf(ticket: QueueTicket): QueueAttributes {
  return {
    mode: ticket.mode,
    difficulty: ticket.difficulty,
    ladder: ticket.ladder,
    era: ticket.era,
  };
}

/** The span attributes of a ticket: the four bounded keys of QUE-16 and nothing else. */
export function setAttributesOf(ticket: QueueTicket): Record<string, string> {
  return {
    [D2R_QUEUE_MODE]: ticket.mode,
    [D2R_DIFFICULTY]: ticket.difficulty,
    [D2R_LADDER]: ticket.ladder,
    [D2R_ERA]: ticket.era,
  };
}

/** The key of a metric attribute set, so the sizes of one set are reported together. */
export function attributeKey(attributes: QueueAttributes): string {
  return [attributes.mode, attributes.difficulty, attributes.ladder, attributes.era].join('|');
}
