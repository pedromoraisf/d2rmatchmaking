// The telemetry numbers of the run and their budget check (AD-097; LB-21, LB-22). Pure. The bytes are the sink's count
// of what the API exported in the measuring window (AD-116); the relay allowance is reported beside them, not added.

import { bytesPerPlayerHour } from './bytes.mjs';

const MODEL_PLAYERS = 100;
const HOURS_PER_MONTH = 720;
const MIB = 2 ** 20;
const GIB = 2 ** 30;
const RELAY_ALLOWANCE_MIB_PER_DAY = 16;
const DAYS_PER_MONTH = 30;
const MONTHLY_BUDGET_BYTES = 5 * GIB;

/** Telemetry may take at most this share of the monthly egress budget (AD-097). */
export const TELEMETRY_SHARE_LIMIT = 0.1;

/**
 * The four telemetry numbers of the summary.
 * @param {number} bytesInWindow bytes the API exported to the sink in the measuring window
 * @param {number} players players of the step (the 100-player step)
 * @param {number} windowSeconds length of the measuring window
 * @returns {{
 *   telemetryBytesPerPlayerHour: number,
 *   telemetryMonthlyBytes: number,
 *   relayAllowanceMonthlyBytes: number,
 *   telemetryShareOfBudget: number,
 * }}
 */
export function telemetryNumbers(bytesInWindow, players, windowSeconds) {
  const telemetryBytesPerPlayerHour = bytesPerPlayerHour(bytesInWindow, players, windowSeconds);
  const telemetryMonthlyBytes = telemetryBytesPerPlayerHour * MODEL_PLAYERS * HOURS_PER_MONTH;
  return {
    telemetryBytesPerPlayerHour,
    telemetryMonthlyBytes,
    relayAllowanceMonthlyBytes: RELAY_ALLOWANCE_MIB_PER_DAY * MIB * DAYS_PER_MONTH,
    telemetryShareOfBudget: telemetryMonthlyBytes / MONTHLY_BUDGET_BYTES,
  };
}

/**
 * True only above the limit: exactly 0.10 passes.
 * @param {number} share telemetryShareOfBudget
 * @returns {boolean}
 */
export function telemetryFails(share) {
  return share > TELEMETRY_SHARE_LIMIT;
}
