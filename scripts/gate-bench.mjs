#!/usr/bin/env node
// The gate benchmark (gate-precision, GPR-22). Replays every entry of the F0 corpus three times, each as a cold
// `node .claude/hooks/gate.mjs` process whose project is a temporary repository, prints the p50 and the p95 of those
// call times, and exits 1 when the p95 is above 300 ms. Its pure parts (`percentile`, `inputOf`) are exported and
// unit-tested by scripts/test/gate-bench.test.mjs.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(here, '..', '.claude', 'hooks', 'gate.mjs');
const FIXTURE = path.join(here, 'test', 'fixtures', 'gate-replay.json');
const RUNS_PER_ENTRY = 3;
const TARGET_P95_MS = 300;

/** The p-th percentile of `values` by the nearest-rank method (the smallest value at or above p percent). */
export function percentile(values, p) {
  if (values.length === 0) throw new Error('percentile needs at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/** A corpus entry as the hook's call: neutral words for `<v>`, the placeholders mapped to the benchmark's paths. */
export function inputOf(entry, root, scratch = path.join(tmpdir(), 'gate-bench-scratch')) {
  const map = (text) =>
    String(text ?? '')
      .replace(/<v>/g, 'v')
      .replace(/<repo>/g, root)
      .replace(/<scratchpad>/g, scratch)
      .replace(/^~/, homedir());
  const base = { session_id: 'gate-bench', cwd: root };
  if (entry.tool === 'Bash')
    return { ...base, tool_name: 'Bash', tool_input: { command: map(entry.input.command) } };
  if (entry.tool === 'Agent') {
    return {
      ...base,
      tool_name: 'Agent',
      tool_input: { subagent_type: entry.input.subagent_type ?? 'general', prompt: '' },
    };
  }
  return { ...base, tool_name: entry.tool, tool_input: { file_path: map(entry.input.file_path) } };
}

// Git's own environment overrides would point the temporary project at the real repository: they are removed.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

/** A temporary git repository, the project each hook call runs in. */
function makeProject() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'gate-bench-')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env: cleanEnv });
  return dir;
}

/** One cold gate process for one call; the time is the wall clock of the whole process, in milliseconds. */
function timeOnce(input, root) {
  const started = performance.now();
  spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(input),
    cwd: root,
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return performance.now() - started;
}

function main() {
  const { entries } = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const root = makeProject();
  const times = [];
  try {
    for (const entry of entries) {
      for (let run = 0; run < RUNS_PER_ENTRY; run++) times.push(timeOnce(inputOf(entry, root), root));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  console.log(
    `gate calls: ${times.length} (${entries.length} corpus entries, ${RUNS_PER_ENTRY} cold runs each)`,
  );
  console.log(`p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms (target: p95 at most ${TARGET_P95_MS} ms)`);
  if (p95 > TARGET_P95_MS) {
    console.error(`gate-bench: p95 ${p95.toFixed(0)} ms is above ${TARGET_P95_MS} ms`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
