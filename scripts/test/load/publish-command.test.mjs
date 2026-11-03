// The publish command over a temporary root (LB-16; design.md § Pure rules, `publish.mjs`). No Docker and no load run: the
// summary is built with the pure summary builder and written where the run writes it, under `reports/load/`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { publishAt, parseArguments } from '../../load/publish.mjs';
import { buildSummary } from '../../load/lib/summary.mjs';

const SCRIPT = fileURLToPath(new URL('../../load/publish.mjs', import.meta.url));
const WITHIN_BUDGET_BYTES = 175000;
const limits = { cpus: '0.5', memory: '512m', k6Memory: '1500m' };
const versions = {
  k6: '2.3.0',
  sseExtension: '0.2.0',
  node: '26.0.0',
  postgres: '17',
  apiImage: 'd2rmm-load-api',
};
const times = { startedAt: '2026-11-03T10:00:00.000Z', endedAt: '2026-11-03T10:20:00.000Z' };
const DOCUMENT = path.join('docs', 'engineering', 'load-baseline.md');

const step = (players, overrides = {}) => ({
  players,
  latencyP95Ms: 300,
  latencyCount: 400,
  errors: 0,
  requests: 2000,
  iterations: 400,
  errorRatio: 0,
  bytesReceived: WITHIN_BUDGET_BYTES,
  telemetryBytes: 10000,
  windowSeconds: 90,
  peakCpuPercent: 40,
  peakMemoryBytes: 300 * 2 ** 20,
  roomsCreated: players,
  containerOk: true,
  passed: true,
  failedRule: null,
  ...overrides,
});

const summaryWith = (profile, steps) =>
  buildSummary({ profile, steps, limits, versions, commit: 'abc1234', times });

/** A temporary root for one case; the caller removes it. */
async function rootDir() {
  return mkdtemp(path.join(os.tmpdir(), 'd2rmm-publish-'));
}

async function writeSummary(root, text) {
  await mkdir(path.join(root, 'reports', 'load'), { recursive: true });
  await writeFile(path.join(root, 'reports', 'load', 'summary.json'), text, 'utf8');
}

test('the publish command writes the document of a passed full summary', async () => {
  const root = await rootDir();
  try {
    await writeSummary(root, JSON.stringify(summaryWith('full', [step(25), step(50), step(100)])));
    const result = await publishAt(root);
    assert.equal(result.exitCode, 0, result.message);
    const text = await readFile(path.join(root, DOCUMENT), 'utf8');
    assert.match(text, /^# Load baseline/);
    assert.match(text, /Most simultaneous players held \(`maxConcurrentPlayers`\) \| 100 \|/);
    assert.deepEqual(
      await readdir(path.join(root, 'docs', 'engineering')),
      ['load-baseline.md'],
      'no staging file is left',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the publish command writes nothing for a missing, smoke, failed or unreadable summary', async () => {
  const cases = [
    { name: 'missing', text: null, reason: /missing/ },
    { name: 'smoke', text: JSON.stringify(summaryWith('smoke', [step(5)])), reason: /smoke/ },
    {
      name: 'failed',
      text: JSON.stringify(
        summaryWith('full', [step(25), step(100, { passed: false, failedRule: 'errors' })]),
      ),
      reason: /did not pass/,
    },
    { name: 'unreadable', text: '{not json', reason: /not valid JSON/ },
  ];
  for (const scenario of cases) {
    const root = await rootDir();
    try {
      if (scenario.text !== null) await writeSummary(root, scenario.text);
      const result = await publishAt(root);
      assert.equal(result.exitCode, 1, `${scenario.name} is refused`);
      assert.match(result.message, scenario.reason, `${scenario.name} names its reason`);
      assert.equal(existsSync(path.join(root, DOCUMENT)), false, `${scenario.name} writes no document`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('the publish command runs from the shell and exits 1 for a missing summary', async () => {
  const root = await rootDir();
  try {
    const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /missing/);
    assert.equal(existsSync(path.join(root, DOCUMENT)), false, 'no document is written');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the publish command takes only --root', () => {
  const repositoryRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  assert.equal(parseArguments([]).root, repositoryRoot, 'the repository root by default');
  assert.equal(
    parseArguments(['--root', 'some-dir']).root,
    path.resolve('some-dir'),
    'an explicit root is resolved',
  );
  assert.ok('error' in parseArguments(['--root']), 'a missing value is refused');
  assert.ok('error' in parseArguments(['--root', '']), 'an empty value is refused');
  assert.ok('error' in parseArguments(['--out', 'x']), 'another option is refused');
});
