// The nightly report (NGT-03). `buildReport` and its helpers are pure (NGT-10); the CLI at the bottom reads the
// downloaded artifacts and writes nightly-report.md and nightly-report.json.
//
//   node scripts/nightly/report.mjs --in <artifacts dir> --out <dir> --commit <sha> --branch <name> --run <id>
//        --suites all|mutation,load,acceptance --jobs <gh api .../jobs json> [--previous <nightly-report.json>]
//        [--reading-modules <json>]
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromPlaywright } from './acceptance.mjs';
import { fromLoadSummary } from './load.mjs';
import { mergeOutcomes } from './merge-mutants.mjs';
import { fromCargoMutants, fromStryker } from './mutation.mjs';
import { toMarkdown } from './render.mjs';
import { compare } from './trend.mjs';

export const ALL_SUITES = ['mutation', 'load', 'acceptance'];

/** `all` (or an empty value) selects every suite; otherwise a comma separated list. */
export function suitesFrom(value) {
  const names = String(value ?? 'all')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0 || names.includes('all')) return [...ALL_SUITES];
  return ALL_SUITES.filter((s) => names.includes(s));
}

/** The jobs of `gh api repos/<repo>/actions/runs/<id>/jobs` -> `{ name, result, minutes }`. */
export function fromJobs(response) {
  return (response?.jobs ?? []).map((job) => {
    const started = Date.parse(job.started_at ?? '');
    const completed = Date.parse(job.completed_at ?? '');
    const minutes =
      Number.isFinite(started) && Number.isFinite(completed) ? (completed - started) / 60000 : null;
    return { name: job.name, result: job.conclusion ?? job.status ?? 'unknown', minutes };
  });
}

/** The reading-module paths of `scripts/agent/reading-modules.json`, whatever the list is called there. */
export function readingModulesFrom(json) {
  const list = Array.isArray(json) ? json : (json?.modules ?? json?.files ?? json?.readingModules ?? []);
  return list.map((entry) => (typeof entry === 'string' ? entry : entry?.path)).filter(Boolean);
}

/**
 * The report of one run.
 * @param {{
 *   commit: string, branch: string, run?: string | null, suites: string[], jobs: object[],
 *   agentOutcomes?: Record<string, object[]>,   crate -> parsed outcomes.json of each shard
 *   apiReports?: Record<string, object>,        layer -> parsed Stryker report
 *   load?: { summary: object | null, check: 'passed' | 'failed' | null } | null,
 *   acceptance?: object | null,                 parsed Playwright JSON
 *   readingModules?: string[],
 *   previous?: object | null,
 * }} input
 */
export function buildReport(input) {
  const mutation = [
    ...Object.entries(input.agentOutcomes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([crate, shards]) => ({
        target: `agent-${crate}`,
        ...fromCargoMutants(mergeOutcomes(shards), input.readingModules ?? []),
      })),
    ...Object.entries(input.apiReports ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([layer, report]) => ({ target: `api-${layer}`, ...fromStryker(report) })),
  ];
  const report = {
    commit: input.commit,
    branch: input.branch,
    run: input.run ?? null,
    suites: input.suites,
    jobs: input.jobs,
    mutation,
    load: input.load ? fromLoadSummary(input.load.summary, undefined, input.load.check) : null,
    acceptance: input.acceptance ? fromPlaywright(input.acceptance) : null,
  };
  return { ...report, trend: compare(report, input.previous ?? null) };
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function findAll(root, name) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) found.push(...findAll(full, name));
    else if (entry === name) found.push(full);
  }
  return found.sort();
}

/**
 * Reads the downloaded artifacts: `agent-mutation-<crate>[-<shard>]/**\/outcomes.json`,
 * `api-mutation-<layer>/**\/mutation.json`, `acceptance-report/**\/results.json`, `load-report/summary.json` and
 * the optional `load-report/check.json` (`{ "verdict": "passed" | "failed" }`).
 */
export function discover(dir) {
  const agentOutcomes = {};
  const apiReports = {};
  const entries = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const name of entries) {
    const root = path.join(dir, name);
    if (!statSync(root).isDirectory()) continue;
    const agent = /^agent-mutation-(.+?)(?:-\d+)?$/u.exec(name);
    const api = /^api-mutation-(.+)$/u.exec(name);
    if (agent) {
      for (const file of findAll(root, 'outcomes.json'))
        (agentOutcomes[agent[1]] ??= []).push(readJson(file));
    } else if (api) {
      const [file] = findAll(root, 'mutation.json');
      if (file) apiReports[api[1]] = readJson(file);
    }
  }
  const [results] = findAll(path.join(dir, 'acceptance-report'), 'results.json');
  const [summary] = findAll(path.join(dir, 'load-report'), 'summary.json');
  const [check] = findAll(path.join(dir, 'load-report'), 'check.json');
  return {
    agentOutcomes,
    apiReports,
    acceptance: results ? readJson(results) : null,
    load: summary
      ? { summary: readJson(summary), check: check ? (readJson(check).verdict ?? null) : null }
      : null,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/u, '')] = argv[i + 1];
  return args;
}

export function main(argv) {
  const args = parseArgs(argv);
  const out = args.out ?? 'reports/nightly';
  const found = discover(args.in ?? 'reports/artifacts');
  const readingFile = args['reading-modules'] ?? 'scripts/agent/reading-modules.json';
  const report = buildReport({
    commit: args.commit ?? 'unknown',
    branch: args.branch ?? 'unknown',
    run: args.run ?? null,
    suites: suitesFrom(args.suites),
    jobs: args.jobs && existsSync(args.jobs) ? fromJobs(readJson(args.jobs)) : [],
    ...found,
    readingModules: existsSync(readingFile) ? readingModulesFrom(readJson(readingFile)) : [],
    previous: args.previous && existsSync(args.previous) ? readJson(args.previous) : null,
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'nightly-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(out, 'nightly-report.md'), toMarkdown(report));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
