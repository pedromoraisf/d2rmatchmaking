// The error sink of the platform (OBS-26): the outbox relay and the stream hub report their failures through it, so each
// line goes through the application logger with its trace fields and through the log export. The composition root
// passes the Fastify logger; the platform never writes to the console itself.
import type { Clock } from '../shared-kernel/index.ts';

export interface ErrorLog {
  error(message: string): void;
}

const ONE_MINUTE_MS = 60 * 1000;

/**
 * Passes at most one line a minute to `inner` and drops the lines between (OBS-37: a dead backend logs one export error a
 * minute). The first line of a run always passes.
 */
export function atMostOnePerMinute(inner: ErrorLog, clock: Clock): ErrorLog {
  let passedAt: number | undefined;
  return {
    error(message) {
      const now = clock.now().getTime();
      if (passedAt !== undefined && now - passedAt < ONE_MINUTE_MS) {
        return;
      }
      passedAt = now;
      inner.error(message);
    },
  };
}
