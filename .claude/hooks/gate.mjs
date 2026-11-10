#!/usr/bin/env node
// PreToolUse gate (ADR 029): denies what cannot be undone or leaks a secret, asks for the maintainer's items, allows
// the rest. No state, no ledger, no network. An exception in the gate allows the call: CI and the reviews still run.
import { execFileSync } from 'node:child_process';
import { readStdinJson, projectDir, toRelative } from './lib/io.mjs';
import { decide } from './lib/gate-rules.mjs';

const input = await readStdinJson();
const root = projectDir(input);
const isTracked = (rel) => {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], {
      cwd: root,
      stdio: 'ignore',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
};

let verdict = null;
try {
  verdict = decide(input, { toRelative: (p) => toRelative(root, p), isTracked });
} catch (e) {
  process.stderr.write(`[d2rmm gate] rule error, call allowed: ${e.message}\n`);
}
if (verdict) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
        permissionDecisionReason: `[d2rmm gate] ${verdict.reason}`,
      },
    }),
  );
}
process.exit(0);
