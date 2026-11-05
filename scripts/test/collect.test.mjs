import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  collect,
  strykerScore,
  cargoMutantsScore,
  harnessField,
  pointer,
  eslintWarnings,
} from '../lib/collect.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseline = JSON.parse(readFileSync(path.join(root, '.quality-baseline.json'), 'utf8'));
const agentCore = baseline.metrics['mutation.agent.core'];

// The outcomes file of a cargo-mutants run, one summary per mutant.
const outcomesOf = (...summaries) => ({ outcomes: summaries.map((summary) => ({ summary })) });

// collect() on the real baseline, in a temporary root that holds the given outcomes at the baseline's path.
function collectWith(report) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crf-collect-'));
  try {
    if (report !== undefined) {
      const file = path.join(dir, agentCore.source.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(report));
    }
    return collect(baseline, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('stryker score counts killed+timeout over valid mutants', () => {
  const report = {
    files: {
      'a.ts': {
        mutants: [
          { status: 'Killed' },
          { status: 'Survived' },
          { status: 'Timeout' },
          { status: 'NoCoverage' },
          { status: 'CompileError' },
        ],
      },
    },
  };
  assert.equal(strykerScore(report), 50);
  assert.equal(strykerScore({ files: {} }), null);
});

test('cargo-mutants score ignores unviable mutants', () => {
  const o = {
    outcomes: [
      { summary: 'CaughtMutant' },
      { summary: 'MissedMutant' },
      { summary: 'Unviable' },
      { summary: 'Timeout' },
    ],
  };
  assert.equal(cargoMutantsScore(o), 66.67);
});

test('harness-score report fields', () => {
  const r = {
    level: { index: 4 },
    score: { percent: 91 },
    checks: [{ passed: false }, { passed: true }, { passed: false, applicable: false }],
  };
  assert.equal(harnessField(r, 'level'), 4);
  assert.equal(harnessField(r, 'percent'), 91);
  assert.equal(harnessField(r, 'failed'), 1);
  assert.equal(harnessField(null, 'failed'), undefined, 'a missing report is not a measurement');
});

test('json pointer and eslint counts', () => {
  assert.equal(pointer({ a: { b: 3 } }, '/a/b'), 3);
  assert.equal(pointer(null, '/a'), undefined);
  assert.equal(
    eslintWarnings([
      { warningCount: 1, errorCount: 2 },
      { warningCount: 0, errorCount: 0 },
    ]),
    3,
  );
});

// CRF-04, CRF-07 (ci-and-review-fixes): cargo-mutants writes mutants.out inside the nightly's --output directory.
test("the agent core source is inside the nightly's report directory", () => {
  const nightly = parse(readFileSync(path.join(root, '.github', 'workflows', 'nightly.yml'), 'utf8'));
  const runs = nightly.jobs['agent-mutation'].steps.map((step) => step.run ?? '');
  const run = runs.find((line) => /--package d2rmm-agent-core(\s|$)/u.test(line)) ?? '';
  const output = /--output\s+(\S+)/u.exec(run)?.[1];
  assert.ok(output, 'the nightly writes the agent core report to a directory');
  assert.equal(agentCore.source.path, path.posix.join(output, 'mutants.out', 'outcomes.json'));
});

// CRF-05 (ci-and-review-fixes): the score is caught / (caught + missed) in percent, read at the baseline's path.
test('agent core score at the baseline path', () => {
  assert.equal(collectWith(outcomesOf('MissedMutant'))['mutation.agent.core'], 0, '0 caught of 1');
  assert.equal(
    collectWith(outcomesOf('CaughtMutant', 'CaughtMutant'))['mutation.agent.core'],
    100,
    'all caught',
  );
  assert.equal(
    collectWith(
      outcomesOf('CaughtMutant', 'CaughtMutant', 'CaughtMutant', 'MissedMutant', 'Unviable', 'Unviable'),
    )['mutation.agent.core'],
    75,
    '3 caught, 1 missed and 2 unviable',
  );
});

// CRF-06 (ci-and-review-fixes): the rule of the metric is unchanged by the path fix.
test('the agent core metric keeps its rule', () => {
  assert.equal(agentCore.direction, 'higher');
  assert.equal(agentCore.floor, 70);
  assert.equal(agentCore.tolerance, 0.02);
  assert.deepEqual(agentCore.contexts, ['nightly', 'phase']);
});

// CRF-08 (ci-and-review-fixes): an absent, an empty and an unviable-only report leave the metric unset.
test('agent core metric stays unset without a score', () => {
  assert.equal(Object.hasOwn(collectWith(undefined), 'mutation.agent.core'), false, 'an absent file');
  assert.equal(
    Object.hasOwn(collectWith(outcomesOf()), 'mutation.agent.core'),
    false,
    'an empty outcomes list',
  );
  assert.equal(
    Object.hasOwn(collectWith(outcomesOf('Unviable', 'Unviable')), 'mutation.agent.core'),
    false,
    'an unviable-only list',
  );
});
