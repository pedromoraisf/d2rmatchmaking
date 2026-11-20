// Pure rules for the load section of the nightly report (NGT-05, NGT-10). No I/O: the CLI reads the files.
import { bytesPerPlayerHour, EGRESS_BYTES_PER_PLAYER_HOUR } from '../load/lib/bytes.mjs';

const round = (n) => Math.round(n);
/** A latency in milliseconds at two decimals, so a float residue (`12.300000000000001`) never reaches the report (UPK-05). */
export const roundMs = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

function bytesOfStep(step) {
  const players = step.players;
  const window = step.windowSeconds;
  if (!(players > 0) || !(window > 0) || typeof step.bytesReceived !== 'number') return null;
  return round(bytesPerPlayerHour(step.bytesReceived, players, window));
}

/**
 * The summary of `pnpm test:load` (reports/load/summary.json) -> the report's load section.
 * `check` is the verdict of `full-summary.check.mjs` ('passed' | 'failed'), or null when it did not run.
 * @param {object | null | undefined} summary
 * @param {number} [budget] bytes per player-hour
 * @param {'passed' | 'failed' | null} [check]
 */
export function fromLoadSummary(summary, budget = EGRESS_BYTES_PER_PLAYER_HOUR, check = null) {
  if (summary === null || summary === undefined) {
    return { verdict: 'not-run', check, steps: [], maxConcurrentPlayers: null, failure: null, error: null };
  }
  const steps = (summary.steps ?? []).map((step) => {
    const perHour = bytesOfStep(step);
    return {
      players: step.players,
      errors: step.errors ?? 0,
      p95Ms: roundMs(step.latencyP95Ms),
      bytesPerPlayerHour: perHour,
      budget,
      withinBudget: perHour === null ? null : perHour <= budget,
      rooms: step.roomsCreated ?? 0,
      passed: step.passed === true,
    };
  });
  const ok = summary.passed === true && (summary.error ?? null) === null;
  return {
    verdict: ok ? 'passed' : 'failed',
    check,
    steps,
    maxConcurrentPlayers: summary.maxConcurrentPlayers ?? null,
    failure: summary.failure ?? null,
    error: summary.error ?? null,
  };
}
