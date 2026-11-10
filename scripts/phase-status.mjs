#!/usr/bin/env node
// Where is the phase? Derived from the brief, the feature files and git (ADR 029).
//
//   node scripts/phase-status.mjs [F<n>]          summary + what may run now
//   node scripts/phase-status.mjs [F<n>] --json   machine-readable state
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { derivePhaseState } from './lib/phase-state.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
const git = (...a) => {
  try {
    execFileSync('git', a, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const exists = (ref) => git('rev-parse', '--verify', '--quiet', ref);
const isAncestor = (a, b) => exists(a) && exists(b) && git('merge-base', '--is-ancestor', a, b);

const phase = args.find((a) => /^F\d+$/.test(a)) ?? (read('.specs/phases/ACTIVE') ?? '').trim();
if (!/^F\d+$/.test(phase)) {
  console.log('phase-status: no active phase (.specs/phases/ACTIVE is empty). Next: /phase-kickoff F<n>.');
  process.exit(0);
}
const phaseRefs = [`phase/${phase}`, `origin/phase/${phase}`];
// A feature is merged when its branch (local or pushed) is in the phase branch.
const merged = (feature) =>
  [`feat/${phase}-${feature}`, `origin/feat/${phase}-${feature}`].some((b) =>
    phaseRefs.some((p) => isAncestor(b, p)),
  );

const state = derivePhaseState({
  phase,
  brief: read(`.specs/phases/${phase}/brief.md`),
  review: read(`.specs/phases/${phase}/review.md`),
  mergedToMain: phaseRefs.some((p) => isAncestor(p, 'origin/main') || isAncestor(p, 'main')),
  file: (f, name) => read(`.specs/features/${f}/${name}`),
  merged,
});

if (args.includes('--json')) {
  console.log(JSON.stringify(state, null, 2));
} else {
  console.log(`phase ${phase}: next = ${state.next}`);
  for (const f of state.features) {
    const wait = f.waitingOn.length ? ` (waiting on ${f.waitingOn.join(', ')})` : '';
    console.log(
      `  ${f.next.padEnd(8)} ${f.feature.padEnd(22)} tasks ${f.tasks.done}/${f.tasks.total}${wait}`,
    );
  }
  if (state.runnable.length)
    console.log(`runnable now: ${state.runnable.map((r) => `${r.feature}→${r.next}`).join(', ')}`);
}
