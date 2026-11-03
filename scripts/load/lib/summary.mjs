// The summary of a run from its step results (design.md § Data Models; LB-10 to LB-15, LB-22). Pure: plain step results in,
// the Summary out. The output is built field by field from a whitelist, never by a spread, so a cookie or a token that a
// caller passes in cannot reach the file (LB-15; AGENTS.md rule 6).

import { bytesPerPlayerHour, withinEgressBudget } from './bytes.mjs';
import { containsSecret } from './redact.mjs';
import { telemetryFails, telemetryNumbers } from './telemetry-share.mjs';

const REFERENCE_PLAYERS = 100;
const CEILING_PLAYERS = 400;
const RULES = ['container', 'errors', 'latency'];
const WITHHELD = 'details withheld (secret text)';
const RELAY_ALLOWANCE_MONTHLY_BYTES = telemetryNumbers(0, 1, 1).relayAllowanceMonthlyBytes;

function numberOf(name, value, minimum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(`${name} must be a number of at least ${minimum}, got ${String(value)}`);
  }
  return value;
}

function nullableNumberOf(name, value) {
  return value === null ? null : numberOf(name, value, 0);
}

function booleanOf(name, value) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function textOf(name, value) {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
}

/** Free text that a caller passes in. Text that carries secret text is withheld, never written (fail closed). */
function safeText(name, value) {
  const text = textOf(name, value);
  return containsSecret(text) ? WITHHELD : text;
}

/** One step result, field by field: the StepResult of design.md and nothing else. */
function stepOf(step) {
  const failedRule = step.failedRule ?? null;
  const passed = booleanOf('passed', step.passed);
  if (passed && failedRule !== null) {
    throw new TypeError('a passed step has no failed rule');
  }
  if (!passed && !RULES.includes(failedRule)) {
    throw new TypeError('a failed step names one of container, errors or latency');
  }
  return {
    players: numberOf('players', step.players, 1),
    latencyP95Ms: nullableNumberOf('latencyP95Ms', step.latencyP95Ms),
    latencyCount: numberOf('latencyCount', step.latencyCount, 0),
    errors: numberOf('errors', step.errors, 0),
    requests: numberOf('requests', step.requests, 0),
    iterations: numberOf('iterations', step.iterations, 0),
    errorRatio: numberOf('errorRatio', step.errorRatio, 0),
    bytesReceived: numberOf('bytesReceived', step.bytesReceived, 0),
    telemetryBytes: numberOf('telemetryBytes', step.telemetryBytes, 0),
    windowSeconds: numberOf('windowSeconds', step.windowSeconds, Number.MIN_VALUE),
    peakCpuPercent: numberOf('peakCpuPercent', step.peakCpuPercent, 0),
    peakMemoryBytes: numberOf('peakMemoryBytes', step.peakMemoryBytes, 0),
    roomsCreated: numberOf('roomsCreated', step.roomsCreated, 0),
    containerOk: booleanOf('containerOk', step.containerOk),
    passed,
    failedRule: passed ? null : failedRule,
  };
}

/** The steps up to the first failure, all passing: the prefix that counts for the highest passing step. */
function passingPrefixOf(rows) {
  const prefix = [];
  for (const row of rows) {
    if (!row.passed) {
      break;
    }
    prefix.push(row);
  }
  return prefix;
}

/** The three numbers that the 100-player step decides, computed from its window and its bytes (LB-13, LB-14, LB-21). */
function referenceNumbersOf(reference) {
  const telemetry = telemetryNumbers(reference.telemetryBytes, REFERENCE_PLAYERS, reference.windowSeconds);
  return {
    p95StateLatencyMs: reference.latencyP95Ms,
    bytesPerPlayerHour: bytesPerPlayerHour(
      reference.bytesReceived,
      REFERENCE_PLAYERS,
      reference.windowSeconds,
    ),
    telemetry,
  };
}

/**
 * The summary of a run. `maxConcurrentPlayers` is the highest passing step with every earlier step passing. The minimum
 * is the 100-player step passing (the smoke profile: its one step passing). A telemetry share above 10% fails the run
 * after a 100-player pass. A later failure after that pass leaves the run passed, and the failure names the later step.
 * @param {{
 *   profile: 'full' | 'smoke',
 *   steps: object[],
 *   limits: { cpus: string, memory: string, k6Memory: string },
 *   versions: { k6: string, sseExtension: string, node: string, postgres: string, openssl: string, apiImage: string },
 *   commit: string,
 *   times: { startedAt: string, endedAt: string },
 *   error?: string | null,
 * }} input
 * @returns {object} the Summary of design.md
 */
export function buildSummary({ profile, steps, limits, versions, commit, times, error = null }) {
  if (profile !== 'full' && profile !== 'smoke') {
    throw new TypeError(`unknown profile: ${String(profile)}`);
  }
  if (!Array.isArray(steps)) {
    throw new TypeError('steps must be an array');
  }
  const rows = steps.map(stepOf);
  const prefix = passingPrefixOf(rows);
  const highest = prefix.at(-1) ?? null;

  const reference = rows.find((row) => row.players === REFERENCE_PLAYERS) ?? null;
  const numbers = reference === null ? null : referenceNumbersOf(reference);
  const hundredPassed = reference !== null && reference.passed;
  const minimumMet = profile === 'smoke' ? rows.length > 0 && rows.every((row) => row.passed) : hundredPassed;
  const telemetryFailed =
    hundredPassed && numbers !== null && telemetryFails(numbers.telemetry.telemetryShareOfBudget);

  const firstFailed = rows.find((row) => !row.passed) ?? null;
  let failure = null;
  if (telemetryFailed) {
    failure = { step: REFERENCE_PLAYERS, rule: 'telemetry' };
  } else if (firstFailed !== null) {
    failure = { step: firstFailed.players, rule: firstFailed.failedRule };
  }

  const errorText = error === null ? null : safeText('error', error);
  const maxConcurrentPlayers = highest?.players ?? 0;
  const bph = numbers?.bytesPerPlayerHour ?? null;

  return {
    maxConcurrentPlayers,
    maxConcurrentRooms: highest?.roomsCreated ?? 0,
    bytesPerPlayerHour: bph,
    p95StateLatencyMs: numbers?.p95StateLatencyMs ?? null,
    passed: errorText === null && minimumMet && !telemetryFailed,
    failure,
    error: errorText,
    ceilingReached: maxConcurrentPlayers === CEILING_PLAYERS,
    profile,
    limits: {
      cpus: safeText('limits.cpus', limits.cpus),
      memory: safeText('limits.memory', limits.memory),
      k6Memory: safeText('limits.k6Memory', limits.k6Memory),
    },
    versions: {
      k6: safeText('versions.k6', versions.k6),
      sseExtension: safeText('versions.sseExtension', versions.sseExtension),
      node: safeText('versions.node', versions.node),
      postgres: safeText('versions.postgres', versions.postgres),
      openssl: safeText('versions.openssl', versions.openssl),
      apiImage: safeText('versions.apiImage', versions.apiImage),
    },
    commit: safeText('commit', commit),
    startedAt: safeText('times.startedAt', times.startedAt),
    endedAt: safeText('times.endedAt', times.endedAt),
    withinEgressBudget: bph === null ? null : withinEgressBudget(bph),
    telemetryBytesPerPlayerHour: numbers?.telemetry.telemetryBytesPerPlayerHour ?? null,
    telemetryMonthlyBytes: numbers?.telemetry.telemetryMonthlyBytes ?? null,
    relayAllowanceMonthlyBytes: RELAY_ALLOWANCE_MONTHLY_BYTES,
    telemetryShareOfBudget: numbers?.telemetry.telemetryShareOfBudget ?? null,
    steps: rows.map((row) => ({ ...row })),
  };
}

/**
 * The exit code of a run: zero only when the summary passed with no tool error and no telemetry failure.
 * @param {{ passed: boolean, error: string | null, failure: { rule: string } | null }} summary
 * @returns {0 | 1}
 */
export function exitCodeOf(summary) {
  const telemetry = summary.failure?.rule === 'telemetry';
  return summary.passed === true && summary.error === null && !telemetry ? 0 : 1;
}
