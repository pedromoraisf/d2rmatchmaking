#!/usr/bin/env node
// Writes the sensor reports the quality collector reads (ADR 021, HF-07): reports/depcruise.json, reports/eslint.json
// and reports/tests-summary.json. It is a producer only: it never decides pass or fail, that is quality-ratchet's job.
// Each sensor's report is kept even when the sensor fails; the exit code is non-zero only when a report is missing.
// Usage: node scripts/quality-reports.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { summarize } from './lib/tests-summary.mjs';

const root = process.cwd();
const reportFiles = {
  depcruise: 'reports/depcruise.json',
  eslint: 'reports/eslint.json',
  vitest: 'reports/vitest.json',
  testsSummary: 'reports/tests-summary.json',
};

// Stale reports must not pass for fresh ones: remove them before any sensor runs.
mkdirSync(path.join(root, 'reports'), { recursive: true });
for (const file of Object.values(reportFiles)) rmSync(path.join(root, file), { force: true });

// A failing sensor still writes its report, so its exit code is only logged here.
function sensor(name, args) {
  const result = spawnSync('pnpm', ['exec', ...args], { cwd: root, stdio: 'inherit' });
  console.log(`quality-reports: ${name} exited ${result.status ?? `with ${result.signal ?? 'no status'}`}`);
}

sensor('depcruise', [
  'depcruise',
  '--config',
  '.dependency-cruiser.cjs',
  '--output-type',
  'json',
  '--output-to',
  reportFiles.depcruise,
  'apps',
  'packages',
  'tests',
]);
sensor('eslint', ['eslint', '--format', 'json', '--output-file', reportFiles.eslint, '.']);
sensor('vitest', ['vitest', 'run', '--reporter=json', `--outputFile=${reportFiles.vitest}`]);

let summaryWritten = false;
try {
  const vitest = JSON.parse(readFileSync(path.join(root, reportFiles.vitest), 'utf8'));
  writeFileSync(path.join(root, reportFiles.testsSummary), `${JSON.stringify(summarize(vitest), null, 2)}\n`);
  summaryWritten = true;
} catch (error) {
  console.error(`quality-reports: tests summary not written: ${error.message}`);
}

const missing = Object.values(reportFiles).filter((file) => !existsSync(path.join(root, file)));
if (missing.length > 0 || !summaryWritten) {
  console.error(`quality-reports: missing report(s): ${missing.join(', ') || reportFiles.testsSummary}`);
  process.exit(1);
}
console.log(
  `quality-reports: wrote ${reportFiles.depcruise}, ${reportFiles.eslint}, ${reportFiles.testsSummary}`,
);
