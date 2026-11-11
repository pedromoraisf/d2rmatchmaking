// The PvP rating band (QUE-08): a ticket's rating ± (50 + 25 for every full 30 seconds waited), up to ± 400.
// Pure: the caller passes `now` (rule 1, no clock in the domain).

export const BASE_HALF_BAND = 50;
export const HALF_BAND_STEP = 25;
export const HALF_BAND_STEP_MS = 30_000;
export const MAX_HALF_BAND = 400;

export interface RatingBand {
  readonly low: number;
  readonly high: number;
}

/** The half width of the band after `waitedMs` in the queue. A clock that runs backwards waits zero. */
export function halfBandAfter(waitedMs: number): number {
  const steps = Math.floor(Math.max(0, waitedMs) / HALF_BAND_STEP_MS);
  return Math.min(MAX_HALF_BAND, BASE_HALF_BAND + HALF_BAND_STEP * steps);
}

/** The half width of a ticket's band at `now`. */
export function halfBandAt(joinedAt: Date, now: Date): number {
  return halfBandAfter(now.getTime() - joinedAt.getTime());
}

/** The band a ticket shows at `now` (QUE-08, the site's "PvP band"). */
export function bandAt(rating: number, joinedAt: Date, now: Date): RatingBand {
  const half = halfBandAt(joinedAt, now);
  return { low: rating - half, high: rating + half };
}

/**
 * Two PvP tickets match only when each rating lies in the other's band (QUE-08), which is the same as their rating gap
 * being within the smaller of the two half widths.
 */
export function bandsMatch(
  a: { readonly rating: number; readonly joinedAt: Date },
  b: { readonly rating: number; readonly joinedAt: Date },
  now: Date,
): boolean {
  const gap = Math.abs(a.rating - b.rating);
  return gap <= Math.min(halfBandAt(a.joinedAt, now), halfBandAt(b.joinedAt, now));
}
