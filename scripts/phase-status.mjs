#!/usr/bin/env node
// Where is the phase? Derived from evidence only (ADR 024): .specs files, git commit trailers, the retry ledger.
//
//   node scripts/phase-status.mjs [F<n>]            human summary + what may run now
//   node scripts/phase-status.mjs [F<n>] --json     machine-readable state (the runner starts every step from it)
//   node scripts/phase-status.mjs [F<n>] --write    regenerate the brief's "## Runner state" and the committed
//                                                   retry-ledger snapshot (.specs/phases/<F>/attempts.json)
// Idempotent: the same evidence always produces the same output and the same files.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { derivePhaseState, renderRunnerState, writeRunnerState } from './lib/phase-state.mjs';
import { featureBlocked } from './lib/budget.mjs';
import { ledgerPath, loadLedger } from './lib/ledger-store.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};
const SEP = '\u001e';
const commits = (...range) =>
  (git('log', ...range, `--format=%H%n%B${SEP}`) ?? '')
    .split(SEP)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => ({ sha: c.split('\n')[0], body: c }));

const phase = args.find((a) => /^F\d+$/.test(a)) ?? (read('.specs/phases/ACTIVE') ?? '').trim();
if (!/^F\d+$/.test(phase)) {
  console.log('phase-status: no active phase (.specs/phases/ACTIVE is empty). Next: /phase-kickoff F<n>.');
  process.exit(0);
}
const briefRel = `.specs/phases/${phase}/brief.md`;
const phaseBranch = `phase/${phase}`;
const hasPhaseBranch = git('rev-parse', '--verify', '--quiet', phaseBranch) !== null;
const ledger = loadLedger(ledgerPath(root), root);

const state = derivePhaseState({
  phase,
  brief: read(briefRel),
  review: read(`.specs/phases/${phase}/review.md`),
  mergedToMain: hasPhaseBranch && git('merge-base', '--is-ancestor', phaseBranch, 'main') !== null,
  file: (f, name) => read(`.specs/features/${f}/${name}`),
  commits: commits('--all'),
  phaseCommits: hasPhaseBranch ? commits(phaseBranch) : [],
  blocked: (f) => featureBlocked(ledger, f),
});

if (args.includes('--json')) {
  console.log(JSON.stringify(state, null, 2));
} else {
  console.log(`phase ${phase}: next = ${state.next}${state.phaseBlocked ? '  ⚠ PHASE BLOCKED — escalate' : ''}`);
  for (const s of state.features) {
    const extra = s.waitingOn.length ? ` (waiting on ${s.waitingOn.join(', ')})` : '';
    console.log(`  ${s.status.padEnd(8)} ${s.feature.padEnd(22)} next: ${s.next}${s.task ? ` ${s.task}` : ''}  tasks ${s.tasks.done}/${s.tasks.total}${extra}`);
  }
  if (state.runnable.length) {
    console.log(`runnable now: ${state.runnable.map((r) => `${r.feature}→${r.step}${r.task ? `(${r.task})` : ''}`).join(', ')}`);
  }
}

if (args.includes('--write')) {
  const brief = read(briefRel);
  if (brief !== null) {
    const next = writeRunnerState(brief, renderRunnerState(state));
    if (next !== brief) writeFileSync(path.join(root, briefRel), next);
  }
  const snap = path.join(root, '.specs/phases', phase, 'attempts.json');
  const text = `${JSON.stringify(ledger, null, 2)}\n`;
  if (!existsSync(snap) || readFileSync(snap, 'utf8') !== text) writeFileSync(snap, text);
}
