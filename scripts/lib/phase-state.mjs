// Deterministic phase state (ADR 024). Pure: the state of a phase and of each feature is DERIVED from evidence
// — files in .specs/, commit trailers in git and the retry ledger — never from what an agent remembers or wrote
// in a status table. Re-running a phase therefore resumes exactly where the evidence says, every time.
import { approvalsIn } from '../../.claude/hooks/lib/delegation.mjs';
import { taskIds } from './steps.mjs';

/** Ordered feature steps. `next` is always the first step whose evidence is missing. */
export const FEATURE_STEPS = [
  'specify', // spec.md + acceptance.feature written
  'spec-gate', // gates passed and the delegated approval written in spec.md
  'design', // design.md (Large/Complex only)
  'tasks', // tasks.md written
  'tasks-gate', // gates passed and the delegated approval written in tasks.md
  'execute', // every task id in tasks.md has a commit with trailer "Task: T<n>"
  'proofs', // proofs.md written by check_proofs.py
  'verify', // Verifier ran; findings closed; commit with trailer "Step: verification"
  'integrate', // feature commits reachable from phase/<F>
  'done',
];

export const PHASE_STEPS = [
  'kickoff',
  'awaiting-approval',
  'run',
  'review',
  'awaiting-review',
  'merge',
  'closed',
];

/** Features table of a brief: | Feature | Size | Depends on | … |. */
export function briefFeatures(briefText) {
  const rows = [];
  const section =
    String(briefText ?? '')
      .split(/^## /m)
      .find((s) => /^Features\b/.test(s)) ?? '';
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0]) || /^feature$/i.test(cells[0])) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(cells[0])) continue;
    const deps =
      cells[2] === '—' || cells[2] === '-' || cells[2] === ''
        ? []
        : cells[2].split(/[,\s]+/).filter((d) => /^[a-z0-9-]+$/.test(d));
    rows.push({ feature: cells[0], size: cells[1], dependsOn: deps, covers: cells[4] ?? '' });
  }
  return rows;
}

/** Parse "Feature:", "Task:" and "Step:" trailers from commit bodies. */
export function parseTrailers(body) {
  const t = {};
  for (const line of String(body ?? '').split('\n')) {
    const m = /^(Feature|Task|Step|Phase):\s*(\S+)\s*$/.exec(line.trim());
    if (m) t[m[1].toLowerCase()] = m[2];
  }
  return t;
}

/**
 * @param {object} ev
 * @param {string} ev.phase            e.g. "F0"
 * @param {string|null} ev.brief       brief.md text
 * @param {string|null} ev.review      review.md text
 * @param {boolean} ev.mergedToMain    phase/<F> is an ancestor of main
 * @param {(feature: string, file: string) => string|null} ev.file   read .specs/features/<feature>/<file>
 * @param {Array<{body: string}>} ev.commits        every commit (all branches)
 * @param {Array<{body: string}>} ev.phaseCommits   commits reachable from phase/<F>
 * @param {(feature: string) => boolean} ev.blocked   retry ledger says the feature is blocked
 */
export function derivePhaseState(ev) {
  const features = briefFeatures(ev.brief);
  const commitTrailers = ev.commits.map((c) => parseTrailers(c.body));
  const phaseTrailers = ev.phaseCommits.map((c) => parseTrailers(c.body));
  const tasksDone = (f) =>
    new Set(commitTrailers.filter((t) => t.feature === f && t.task).map((t) => t.task.toUpperCase()));
  const stepDone = (f, s) => commitTrailers.some((t) => t.feature === f && t.step === s);
  // Integrated = the feature's closing commit (Step: verification) is reachable from phase/<F>.
  const merged = (f) => phaseTrailers.some((t) => t.feature === f && t.step === 'verification');

  const states = new Map();
  for (const row of features) {
    const f = row.feature;
    const spec = ev.file(f, 'spec.md');
    const acceptance = ev.file(f, 'acceptance.feature');
    const design = ev.file(f, 'design.md');
    const tasks = ev.file(f, 'tasks.md');
    const ids = taskIds(tasks);
    const done = tasksDone(f);
    const pending = ids.filter((id) => !done.has(id));
    const needsDesign = /large|complex/i.test(row.size);

    let next;
    if (!spec || !acceptance) next = 'specify';
    else if (approvalsIn(spec).length === 0) next = 'spec-gate';
    else if (needsDesign && !design) next = 'design';
    else if (!tasks) next = 'tasks';
    else if (approvalsIn(tasks).length === 0) next = 'tasks-gate';
    else if (ids.length === 0 || pending.length > 0) next = 'execute';
    else if (!ev.file(f, 'proofs.md')) next = 'proofs';
    else if (!ev.file(f, 'verification.md') || !stepDone(f, 'verification')) next = 'verify';
    else if (!merged(f)) next = 'integrate';
    else next = 'done';

    states.set(f, {
      feature: f,
      size: row.size,
      dependsOn: row.dependsOn,
      next,
      task: next === 'execute' ? (pending[0] ?? null) : null,
      tasks: { total: ids.length, done: ids.length - pending.length },
      blocked: ev.blocked(f),
    });
  }

  // Waiting on dependencies (a dependency counts once it is integrated into the phase branch).
  for (const s of states.values()) {
    const missing = s.dependsOn.filter((d) => states.get(d)?.next !== 'done');
    // A feature waits for its dependencies to be integrated into the phase branch before any step (brief rule).
    s.waitingOn = s.next === 'done' ? [] : missing;
    s.status = s.blocked ? 'blocked' : s.next === 'done' ? 'done' : s.waitingOn.length ? 'waiting' : 'ready';
  }

  let phaseNext;
  const all = [...states.values()];
  if (!ev.brief) phaseNext = 'kickoff';
  else if (approvalsIn(ev.brief).length === 0) phaseNext = 'awaiting-approval';
  else if (all.length === 0) phaseNext = 'kickoff';
  else if (all.some((s) => s.status === 'ready' || s.status === 'waiting')) {
    phaseNext = all.some((s) => s.status === 'ready') ? 'run' : 'review'; // only blocked/waiting-on-blocked left
  } else if (!ev.review) phaseNext = 'review';
  else if (approvalsIn(ev.review).length === 0) phaseNext = 'awaiting-review';
  else if (!ev.mergedToMain) phaseNext = 'merge';
  else phaseNext = 'closed';

  const ready = all.filter((s) => s.status === 'ready');
  return {
    phase: ev.phase,
    next: phaseNext,
    features: all,
    // What may run now, in parallel (each in its own worktree): every ready feature.
    runnable: ready.map((s) => ({ feature: s.feature, step: s.next, task: s.task })),
    phaseBlocked:
      all.length > 0 &&
      ready.length === 0 &&
      all.some((s) => s.status === 'blocked') &&
      all.some((s) => s.status !== 'done' && s.status !== 'blocked'),
  };
}

export function renderRunnerState(state) {
  const rows = state.features.map(
    (s) =>
      `| ${s.feature} | ${s.next}${s.task ? ` (${s.task})` : ''} | ${s.status}${s.waitingOn.length ? ` on ${s.waitingOn.join(', ')}` : ''} | ${s.tasks.done}/${s.tasks.total} |`,
  );
  return [
    '<!-- generated by `pnpm phase:status --write` from files, git trailers and the retry ledger — do not edit -->',
    `**Phase next step**: ${state.next}${state.phaseBlocked ? ' — PHASE BLOCKED: escalate' : ''}`,
    '',
    '| Feature | Next step | Status | Tasks |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** Replace the body of "## Runner state" in a brief (idempotent: same evidence → same text). */
export function writeRunnerState(briefText, rendered) {
  const parts = String(briefText).split(/^(?=## )/m);
  const i = parts.findIndex((p) => p.startsWith('## Runner state'));
  const section = `## Runner state\n\n${rendered}\n`;
  if (i === -1) return `${String(briefText).replace(/\n*$/, '\n\n')}${section}`;
  parts[i] = `${section}${i < parts.length - 1 ? '\n' : ''}`;
  return parts.join('');
}
