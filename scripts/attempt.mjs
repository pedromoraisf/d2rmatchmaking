#!/usr/bin/env node
// Retry-budget wrapper (ADR 022, budget v2 of ADR 028 § 4): the only sanctioned way for an agent to run a gate during a phase.
//
//   node scripts/attempt.mjs run --feature <f> --step <T3|spec|tasks|proofs|verification|integration> [--timeout <minutes>] -- <command…>
//   node scripts/attempt.mjs status [--feature <f>]     exit 1 when the feature has a blocked unit
//   node scripts/attempt.mjs report                     markdown table for the phase review
//   node scripts/attempt.mjs reset --unit <key> --by <maintainer>   maintainer only (the gate hook asks)
//
// Exit codes for `run`: the command's own status when it ran (124 for a timeout, 137 for a kill by SIGKILL); 3 when
// the unit is (or becomes) blocked or env-blocked; 2 for invalid usage (unknown feature or step, a bad --timeout).
// A failure the machine caused (lib/env-signatures.mjs) is recorded and not counted.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_ATTEMPTS,
  MAX_RETRIES,
  FIXED_STEPS,
  unitKey,
  canAttempt,
  recordAttempt,
  blockedMessage,
  failuresOf,
  featureBlocked,
  report,
  reset,
} from './lib/budget.mjs';
import { ledgerPath, loadLedger, withLedger } from './lib/ledger-store.mjs';
import { allowedSteps } from './lib/steps.mjs';
import { classify } from './lib/env-signatures.mjs';
import { runGate, exitStatus } from './lib/gate-run.mjs';
import { diagnose } from './lib/machine-diagnosis.mjs';

const DEFAULT_TIMEOUT_MINUTES = 60;
const MAX_TIMEOUT_MINUTES = 35791; // setTimeout holds at most 2^31 - 1 ms

const root = process.cwd();
const argv = process.argv.slice(2);
const cmd = argv[0];
const sep = argv.indexOf('--');
const opts = argv.slice(1, sep >= 0 ? sep : undefined);
const opt = (name) => {
  const i = opts.indexOf(name);
  return i >= 0 ? opts[i + 1] : undefined;
};
const file = ledgerPath(root);

function usage(msg) {
  console.error(`attempt: ${msg}`);
  process.exit(2);
}

function tail(text, n = 15) {
  return String(text).trim().split('\n').slice(-n).join('\n');
}

/** stdout of a git command run in `cwd`, or null when git fails (no commit yet, not a repository…). */
function gitOutput(cwd, args, { trim = true } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0) return null;
  return trim ? r.stdout.trim() : r.stdout;
}

/** The --timeout of `run` in whole minutes (BUD-27): the default when absent, exit 2 when not a whole number ≥ 1. */
function timeoutMinutes() {
  if (!opts.includes('--timeout')) return DEFAULT_TIMEOUT_MINUTES;
  const v = opt('--timeout') ?? '';
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < 1 || n > MAX_TIMEOUT_MINUTES) {
    usage(`--timeout takes whole minutes from 1 to ${MAX_TIMEOUT_MINUTES}, got "${v}"`);
  }
  return n;
}

if (cmd === 'run') {
  const feature = opt('--feature');
  const step = opt('--step');
  const command = sep >= 0 ? argv.slice(sep + 1).join(' ') : '';
  if (!feature || !step || !command) usage('run needs --feature, --step and -- <command>');
  const minutes = timeoutMinutes();
  const featureDir = path.join(root, '.specs', 'features', feature);
  if (!existsSync(featureDir)) usage(`unknown feature "${feature}" (no .specs/features/${feature}/)`);
  if (!allowedSteps(featureDir).has(step)) {
    usage(`step "${step}" is not a task id in tasks.md nor one of: ${FIXED_STEPS.join(', ')}`);
  }
  const key = unitKey('gate', feature, step);

  const before = loadLedger(file);
  const pre = canAttempt(before, key);
  if (!pre.ok) {
    console.error(pre.reason);
    if (before.units[key]?.status === 'env-blocked') console.error(`\n${diagnose().join('\n')}`);
    process.exit(3);
  }
  console.error(`attempt ${pre.attempt}/${MAX_ATTEMPTS} for ${key}: ${command}`);
  const r = await runGate(command, { cwd: root, timeoutMs: minutes * 60_000 });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  const exit = exitStatus(r);
  const ok = r.status === 0 && !r.timedOut;
  const output = `${r.stdout}\n${r.stderr}`;
  const sig = ok ? null : classify({ status: r.status, signal: r.signal, output, timedOut: r.timedOut });
  const note = ok ? command : `${command} → exit ${exit}: ${tail(output, 6)}`;
  // HBS-25: the commit and the tree state where the command ran, read after it ran, so a command that dirties the
  // tree records `clean: false` (the proof of a green run is only as good as the tree it ran on).
  const head = gitOutput(root, ['rev-parse', 'HEAD']);
  const porcelain = gitOutput(root, ['status', '--porcelain'], { trim: false });
  const clean = porcelain !== null && porcelain.trim() === '';
  const { res, unit } = withLedger(file, (l) => {
    const out = recordAttempt(l, key, ok, {
      note,
      command,
      head,
      clean,
      ...(sig ? { kind: 'env', signature: sig.signature } : {}),
    });
    return { res: out, unit: structuredClone(l.units[key]) };
  });
  if (ok) {
    console.error(`✓ ${key} passed on attempt ${res.attempt}.`);
    process.exit(0);
  }
  if (sig) {
    console.error(
      `\n✗ not counted: ${key} failed because of the machine (signature "${sig.signature}"). The budget is unchanged.`,
    );
    if (res.status === 'env-blocked') {
      console.error(`✗ ${blockedMessage(key, unit)}`);
      console.error(diagnose().join('\n'));
    }
    process.exit(exit);
  }
  if (res.status === 'blocked') {
    console.error(`\n✗ ${blockedMessage(key, unit)}`);
    process.exit(3);
  }
  console.error(
    `\n✗ ${key} failed (failure ${res.failures}/${MAX_ATTEMPTS}). ${res.remainingRetries} of ${MAX_RETRIES} retries left. ` +
      'Fix the root cause before retrying; never weaken the test or the gate.',
  );
  process.exit(exit);
}

if (cmd === 'status') {
  const ledger = loadLedger(file);
  const feature = opt('--feature');
  const units = Object.entries(ledger.units).filter(
    ([k]) => !feature || k.split(':')[1]?.startsWith(`${feature}/`),
  );
  for (const [k, u] of units) {
    console.log(`${u.status.padEnd(7)} ${k}  (${failuresOf(ledger, k)}/${MAX_ATTEMPTS} failures)`);
  }
  if (feature && featureBlocked(ledger, feature)) process.exit(1);
  process.exit(0);
}

if (cmd === 'report') {
  console.log(report(loadLedger(file)));
  process.exit(0);
}

if (cmd === 'reset') {
  const key = opt('--unit');
  const by = opt('--by');
  if (!key || !by) usage('reset needs --unit <key> --by <maintainer>');
  const done = withLedger(file, (l) => reset(l, key, { by }));
  console.log(done ? `reset ${key} (by ${by})` : `nothing to reset for ${key}`);
  process.exit(0);
}

usage('commands: run | status | report | reset');
