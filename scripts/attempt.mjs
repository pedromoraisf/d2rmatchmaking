#!/usr/bin/env node
// Retry-budget wrapper (ADR 022): the only sanctioned way for an agent to run a gate during a phase.
//
//   node scripts/attempt.mjs run --feature <f> --step <T3|spec|tasks|proofs|verification|integration> -- <command…>
//   node scripts/attempt.mjs status [--feature <f>]     exit 1 when the feature has a blocked unit
//   node scripts/attempt.mjs report                     markdown table for the phase review
//   node scripts/attempt.mjs reset --unit <key> --by <maintainer>   maintainer only (the gate hook asks)
//
// Exit codes for `run`: the command's own code while retries remain; 3 when the unit is (or becomes) blocked;
// 2 for invalid usage (unknown feature or step).
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
  featureBlocked,
  report,
  reset,
} from './lib/budget.mjs';
import { ledgerPath, loadLedger, withLedger } from './lib/ledger-store.mjs';
import { allowedSteps } from './lib/steps.mjs';

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

if (cmd === 'run') {
  const feature = opt('--feature');
  const step = opt('--step');
  const command = sep >= 0 ? argv.slice(sep + 1).join(' ') : '';
  if (!feature || !step || !command) usage('run needs --feature, --step and -- <command>');
  const featureDir = path.join(root, '.specs', 'features', feature);
  if (!existsSync(featureDir)) usage(`unknown feature "${feature}" (no .specs/features/${feature}/)`);
  if (!allowedSteps(featureDir).has(step)) {
    usage(`step "${step}" is not a task id in tasks.md nor one of: ${FIXED_STEPS.join(', ')}`);
  }
  const key = unitKey('gate', feature, step);

  const pre = canAttempt(loadLedger(file), key);
  if (!pre.ok) {
    console.error(pre.reason);
    process.exit(3);
  }
  console.error(`attempt ${pre.attempt}/${MAX_ATTEMPTS} for ${key}: ${command}`);
  const r = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  const ok = r.status === 0;
  const note = ok ? command : `${command} → exit ${r.status}: ${tail(`${r.stdout}\n${r.stderr}`, 6)}`;
  const res = withLedger(file, (l) => recordAttempt(l, key, ok, { note }));
  if (ok) {
    console.error(`✓ ${key} passed on attempt ${res.attempt}.`);
    process.exit(0);
  }
  if (res.status === 'blocked') {
    console.error(`\n✗ ${blockedMessage(key, { attempts: [{ ok: false, note }] })}`);
    process.exit(3);
  }
  console.error(
    `\n✗ ${key} failed (failure ${res.failures}/${MAX_ATTEMPTS}). ${res.remainingRetries} of ${MAX_RETRIES} retries left. ` +
      'Fix the root cause before retrying; never weaken the test or the gate.',
  );
  process.exit(r.status ?? 1);
}

if (cmd === 'status') {
  const ledger = loadLedger(file);
  const feature = opt('--feature');
  const units = Object.entries(ledger.units).filter(
    ([k]) => !feature || k.split(':')[1]?.startsWith(`${feature}/`),
  );
  for (const [k, u] of units) {
    console.log(
      `${u.status.padEnd(7)} ${k}  (${u.attempts.filter((a) => !a.ok).length}/${MAX_ATTEMPTS} failures)`,
    );
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
