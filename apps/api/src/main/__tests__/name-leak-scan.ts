// The leak-test harness of a name read on screen (SNM-04): where a distinctive read name, or a part of it, could have been
// kept. A test sends a name through a path, collects what the path left behind and asks `findLeaks`. Every key and value
// is scanned, not only the ones the spec names, since a library can carry a name under any key (lessons: privacy).
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/** What a path left behind. */
export interface Observed {
  readonly spans: readonly ReadableSpan[];
  /** Every log line the app wrote. */
  readonly logs: readonly string[];
  /** The raw body of every answer. */
  readonly responses: readonly string[];
  /** Every row of the tables the path writes, as JSON text (keys and values). */
  readonly rows: readonly string[];
}

/** The parts of `read` that are not in `canonical`: its windows of three characters that the stored spelling lacks. */
export function distinctiveParts(read: string, canonical: string): string[] {
  const known = canonical.toLowerCase();
  const lower = read.toLowerCase();
  const parts: string[] = [];
  for (let at = 0; at + 3 <= lower.length; at += 1) {
    const window = lower.slice(at, at + 3);
    if (!known.includes(window)) parts.push(window);
  }
  return parts;
}

function spanText(span: ReadableSpan): string {
  return JSON.stringify({
    name: span.name,
    attributes: span.attributes,
    events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
    links: span.links.map((link) => link.attributes),
    status: span.status,
    resource: span.resource.attributes,
  });
}

/** The places that hold `read` or one of its distinctive parts, case-insensitively. Empty when nothing leaked. */
export function findLeaks(read: string, canonical: string, observed: Observed): string[] {
  const needles = [read.toLowerCase(), ...distinctiveParts(read, canonical)];
  const places: [string, string][] = [
    ...observed.spans.map((span, index): [string, string] => [`span ${span.name} #${index}`, spanText(span)]),
    ...observed.logs.map((line, index): [string, string] => [`log line #${index}`, line]),
    ...observed.responses.map((body, index): [string, string] => [`response #${index}`, body]),
    ...observed.rows.map((row, index): [string, string] => [`row #${index}`, row]),
  ];
  return places.flatMap(([where, text]) => {
    const lower = text.toLowerCase();
    const hit = needles.find((needle) => lower.includes(needle));
    return hit === undefined ? [] : [`${where} holds a part of the name`];
  });
}
