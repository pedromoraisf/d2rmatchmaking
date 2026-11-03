// Decides whether a summary may be published and renders the baseline document from a whitelist of its fields (LB-16;
// design.md § Pure rules). Pure: a summary in, a plan out. The document carries no run id, no host path, no token and no
// error text: each line below names the summary field it reads, and nothing else is read.

const REFUSED = (reason) => ({ allowed: false, reason });

function numberText(value) {
  if (value === null) {
    return 'not measured';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`a published number must be a finite number or null, got ${String(value)}`);
  }
  return String(Number(value.toPrecision(6)));
}

function yesNo(value) {
  if (value === null) {
    return 'not measured';
  }
  return value ? 'yes' : 'no';
}

function dateOf(endedAt) {
  const time = typeof endedAt === 'string' ? Date.parse(endedAt) : Number.NaN;
  if (Number.isNaN(time)) {
    throw new TypeError('the summary has no valid end time');
  }
  return new Date(time).toISOString().slice(0, 10);
}

function textOf(name, value) {
  if (typeof value !== 'string' || value.includes('\n')) {
    throw new TypeError(`${name} must be one line of text`);
  }
  return value;
}

function stepRow(step) {
  const result = step.passed ? 'passed' : `failed: ${step.failedRule}`;
  return `| ${numberText(step.players)} | ${numberText(step.latencyP95Ms)} | ${numberText(step.errorRatio)} | ${numberText(step.bytesReceived)} | ${numberText(step.peakCpuPercent)} | ${numberText(step.peakMemoryBytes)} | ${result} |`;
}

/** The document text of a full, passed summary. Each value is read by name from the summary. */
function documentOf(summary) {
  const date = dateOf(summary.endedAt);
  const commit = textOf('commit', summary.commit);
  const { cpus, memory, k6Memory } = summary.limits;
  const { k6, sseExtension, node, postgres, apiImage } = summary.versions;
  const ceiling = summary.ceilingReached ? 'yes' : 'no';
  return [
    '# Load baseline',
    '',
    `The first measured load of the main journey (NFR-14). Measured on ${date} at commit \`${commit}\` by \`pnpm test:load\`. The numbers come from \`reports/load/summary.json\` and are written by \`pnpm load:publish\`; do not edit them by hand.`,
    '',
    '## Numbers',
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Most simultaneous players held (\`maxConcurrentPlayers\`) | ${numberText(summary.maxConcurrentPlayers)} |`,
    `| Most rooms in \`created\` at the end of that step (\`maxConcurrentRooms\`) | ${numberText(summary.maxConcurrentRooms)} |`,
    `| p95 state latency at 100 players, ms (\`p95StateLatencyMs\`) | ${numberText(summary.p95StateLatencyMs)} |`,
    `| Bytes per player-hour at 100 players (\`bytesPerPlayerHour\`) | ${numberText(summary.bytesPerPlayerHour)} |`,
    `| Within the 70 000 bytes per player-hour budget (\`withinEgressBudget\`) | ${yesNo(summary.withinEgressBudget)} |`,
    `| Telemetry bytes per player-hour (\`telemetryBytesPerPlayerHour\`) | ${numberText(summary.telemetryBytesPerPlayerHour)} |`,
    `| Telemetry bytes a month at 100 players (\`telemetryMonthlyBytes\`) | ${numberText(summary.telemetryMonthlyBytes)} |`,
    `| Telemetry share of the 5 GiB monthly budget, limit 0.10 (\`telemetryShareOfBudget\`) | ${numberText(summary.telemetryShareOfBudget)} |`,
    `| Relay allowance a month, reported beside the telemetry (\`relayAllowanceMonthlyBytes\`) | ${numberText(summary.relayAllowanceMonthlyBytes)} |`,
    `| Ceiling of 400 players reached (\`ceilingReached\`) | ${ceiling} |`,
    '',
    '## Limits',
    '',
    '| Limit | Value |',
    '| --- | --- |',
    `| API container CPUs (\`LOAD_CPUS\`) | ${textOf('limits.cpus', cpus)} |`,
    `| API container memory (\`LOAD_MEMORY\`) | ${textOf('limits.memory', memory)} |`,
    `| k6 container memory (\`LOAD_K6_MEMORY\`) | ${textOf('limits.k6Memory', k6Memory)} |`,
    '',
    '## Versions',
    '',
    '| Component | Version |',
    '| --- | --- |',
    `| k6 | ${textOf('versions.k6', k6)} |`,
    `| k6 SSE extension | ${textOf('versions.sseExtension', sseExtension)} |`,
    `| Node | ${textOf('versions.node', node)} |`,
    `| Postgres | ${textOf('versions.postgres', postgres)} |`,
    `| API image | ${textOf('versions.apiImage', apiImage)} |`,
    '',
    '## Steps',
    '',
    'An error ratio is the errors over the journey requests plus the iterations of the measuring window. A step passes at a p95 of 2000 ms or less and an error ratio below 1%, with the API container still running.',
    '',
    '| Players | p95 (ms) | Error ratio | Bytes received | Peak API CPU (%) | Peak API memory (bytes) | Result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summary.steps.map(stepRow),
    '',
  ].join('\n');
}

/**
 * Whether the summary may be published. Only a full run that passed with no tool error is published; the smoke profile
 * and every other summary are refused with a reason, and nothing is written.
 * @param {object | null | undefined} summary the parsed `reports/load/summary.json`, or nothing when the file is missing
 * @returns {{ allowed: true, text: string } | { allowed: false, reason: string }}
 */
export function publishPlan(summary) {
  if (summary === null || summary === undefined || typeof summary !== 'object') {
    return REFUSED('the summary is missing: run pnpm test:load first');
  }
  if (summary.profile === 'smoke') {
    return REFUSED('the summary is from the smoke profile, and only a full run is published');
  }
  if (summary.profile !== 'full') {
    return REFUSED('the summary is not from the full profile');
  }
  if (summary.passed !== true) {
    return REFUSED('the summary did not pass, and a failed run is not published');
  }
  if (typeof summary.error === 'string') {
    return REFUSED('the run stopped with a tool error, and it is not published');
  }
  return { allowed: true, text: documentOf(summary) };
}
