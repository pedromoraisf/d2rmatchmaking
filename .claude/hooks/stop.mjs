#!/usr/bin/env node
// Stop hook: before the agent ends its turn, run the affected type checks and tests.
// If anything fails, block the stop and hand the errors back — the agent keeps working.
// Guarded by stop_hook_active so it never loops: a second consecutive stop is let through.
import { existsSync } from 'node:fs';
import { readStdinJson, projectDir, bin, run, tail, makeRepoContext } from './lib/io.mjs';

const input = await readStdinJson();
if (input.stop_hook_active) process.exit(0);
const root = projectDir(input);
const ctx = makeRepoContext(root);

const changed = [
  ...(ctx.git('diff', '--name-only', 'HEAD') ?? '').split('\n'),
  ...(ctx.git('ls-files', '--others', '--exclude-standard') ?? '').split('\n'),
].filter(Boolean);
if (changed.length === 0) process.exit(0);

const any = (re) => changed.some((f) => re.test(f));
const checks = [];
const turbo = bin(root, 'turbo');
if (turbo && existsSync(`${root}/node_modules`) && any(/^(apps|packages)\//)) {
  checks.push(['typecheck', turbo, ['run', 'typecheck', '--affected', '--output-logs=errors-only']]);
  checks.push(['unit tests', turbo, ['run', 'test', '--affected', '--output-logs=errors-only']]);
}
if (turbo && any(/^(packages\/contracts\/src|apps\/api\/src\/modules\/[^/]+\/adapters\/http)\//)) {
  checks.push(['openapi drift', 'pnpm', ['run', 'contracts:check']]);
}
if (any(/^(scripts|\.claude\/hooks)\//)) checks.push(['harness tests', 'node', ['--test', 'scripts/**/*.test.mjs', '.claude/hooks/**/*.test.mjs']]);
if (any(/^\.specs\//)) checks.push(['specs check', 'node', ['scripts/specs-check.mjs']]);
if (any(/^apps\/agent\/src-tauri\//) && existsSync(`${root}/apps/agent/src-tauri/Cargo.toml`)) {
  checks.push(['cargo check', 'cargo', ['check', '--manifest-path', 'apps/agent/src-tauri/Cargo.toml', '--all-targets']]);
}

const failures = [];
for (const [name, cmd, args] of checks) {
  const r = run(cmd, args, { cwd: root, timeoutMs: 300_000 });
  if (!r.ok) failures.push(`## ${name}\n${tail(r.out, 50)}`);
}
if (failures.length > 0) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `[d2rmm stop] Sensors are red. Fix before ending the turn (or record the blocker in the feature's tasks.md Handoff):\n\n${failures.join('\n\n')}`,
    }),
  );
}
process.exit(0);
