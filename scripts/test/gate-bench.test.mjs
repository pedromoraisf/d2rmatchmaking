// GPR-22 (gate-precision): the benchmark's percentile and its per-entry input are right, and no corpus line makes more
// than 8 `git` processes. The spawn count is taken through a counting context: every `git` the rules ask is counted,
// and the answers are fixed. The benchmark itself (scripts/gate-bench.mjs) is a harness run, not a mutation proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { decide } from '../../.claude/hooks/lib/gate-rules.mjs';
import { toRelative } from '../../.claude/hooks/lib/io.mjs';
import { RULE_MODULES } from '../../.claude/hooks/test/rule-modules.mjs';
import { emptyLedger } from '../lib/budget.mjs';
import { inputOf, percentile } from '../gate-bench.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { entries } = JSON.parse(readFileSync(path.join(here, 'fixtures', 'gate-replay.json'), 'utf8'));
const ROOT = '/repo';
const SPAWN_CAP = 8;

test('computes the percentile', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5, 'the median is the fifth value');
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10, 'the 95th percentile is the tenth value');
  assert.equal(percentile([30, 10, 20], 50), 20, 'the input order does not matter');
  assert.equal(percentile([7], 95), 7, 'one value is its own percentile');
  assert.throws(() => percentile([], 50), 'no values have no percentile');
});

test('builds each corpus entry as the hook call of its tool', () => {
  const bash = inputOf({ tool: 'Bash', input: { command: 'cat <v> | head -n 5' } }, ROOT);
  assert.equal(bash.tool_name, 'Bash');
  assert.equal(bash.tool_input.command, 'cat v | head -n 5', 'a value is a neutral word');
  assert.equal(bash.cwd, ROOT);
  const edit = inputOf({ tool: 'Edit', input: { file_path: '<repo>/apps/api/x.ts', size: '<1k' } }, ROOT);
  assert.equal(edit.tool_input.file_path, `${ROOT}/apps/api/x.ts`, 'a checkout path maps to the project');
});

test('stays under the spawn cap', () => {
  let spawns = 0;
  const git = () => {
    spawns += 1;
    return null;
  };
  const ctx = {
    root: ROOT,
    mainRoot: ROOT,
    modules: RULE_MODULES,
    ledger: emptyLedger(),
    verdicts: {},
    now: () => '2026-11-08T00:00:00.000Z',
    nowMs: () => 0,
    readFile: () => null,
    readMainFile: () => null,
    isTracked: () => false,
    currentBranch: () => 'feat/F0-gate-precision',
    headTime: () => 1,
    git: (...args) => git(...args),
    realpath: (p) => p,
    stat: () => null,
  };
  const worst = [];
  for (const entry of entries) {
    spawns = 0;
    decide({ session_id: 'gate-bench', cwd: ROOT, ...inputOf(entry, ROOT) }, ctx, toRelative);
    if (spawns > SPAWN_CAP) worst.push(`${entry.id}: ${spawns}`);
  }
  assert.deepEqual(worst, [], `no corpus line spawns more than ${SPAWN_CAP} git processes`);
});
