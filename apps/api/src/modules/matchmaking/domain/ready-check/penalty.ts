// The wait a member who did not answer a ready check keeps (RDY-05). Pure: the caller passes `now` (rule 1, no clock).

/** The wait after a ready check times out: five minutes from its deadline (RDY-05, FR-13). */
export const PENALTY_MS = 5 * 60 * 1000;

/** The instant a penalty that starts at `at` ends. */
export function penaltyUntil(at: Date): Date {
  return new Date(at.getTime() + PENALTY_MS);
}

/** A penalty holds while `now` is before its end: at the end exactly, the member may queue again. */
export function isPenalized(until: Date, now: Date): boolean {
  return now.getTime() < until.getTime();
}

/** The whole seconds left of a penalty, rounded up, so a refusal never says zero while the wait holds. */
export function penaltySecondsLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
