// Phase state (ADR 029). Pure: derived from the brief, each feature's files and which feature branches merged.
// Nothing comes from what an agent remembers, so any session resumes from the same answer.

export const APPROVED = /^\*\*Approved\*\*:\s*(\S+)\s*-\s*user:\s*"([^"]+)"/m;

/** Features table of a brief: | Feature | Size | Depends on | … |. */
export function briefFeatures(briefText) {
  const section =
    String(briefText ?? '')
      .split(/^## /m)
      .find((s) => /^Features\b/.test(s)) ?? '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3 || !/^[a-z0-9][a-z0-9-]*$/.test(cells[0])) continue;
    const dependsOn = cells[2].split(/[,\s]+/).filter((d) => /^[a-z0-9][a-z0-9-]*$/.test(d));
    rows.push({ feature: cells[0], size: cells[1], dependsOn });
  }
  return rows;
}

/**
 * Task boxes of a tasks.md. A task is a checkbox line, at any indent and under any `##` section, whose label starts
 * with an id: `T<n>` (`T11b-2` too) or `O<n>` (the orchestrator's own steps): `- [ ] T1 — …`, `- [x] O2 — …`.
 * Boxes with no id (the acceptance criteria listed under a task, "- [ ] All tests pass") belong to their task and are
 * not counted. An open task is *waiting* when it is outside the cloud's reach by design, so a feature may reach
 * review with it open: its first line carries `**Waiting**` or `**Runs after the phase PR merges`, or it sits under a
 * `##` heading that says "waits for the maintainer" (the field batches). Every other open task blocks `done`.
 */
export const WAITING_TASK = /\*\*(?:Waiting\*\*|Runs after the phase PR merges)/;
export const WAITING_SECTION = /\bwaits? for the maintainer/i;
export function taskCount(tasksText) {
  let done = 0;
  let total = 0;
  let waiting = 0;
  let sectionWaits = false;
  for (const line of String(tasksText ?? '').split('\n')) {
    if (/^#{1,2} /.test(line)) sectionWaits = WAITING_SECTION.test(line);
    const m = /^\s*- \[([ xX])\] [TO]\d+/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] !== ' ') done += 1;
    else if (sectionWaits || WAITING_TASK.test(line)) waiting += 1;
  }
  return { done, total, open: total - done, waiting };
}

/**
 * A spec that declares `**Phase**: F<n>` belongs to that phase even when the brief's table does not list it (a feature
 * added after the brief, covered by its approval). Returns its row, or null when it belongs to another phase.
 */
export function specRow(feature, specText, phase) {
  const head = String(specText ?? '').match(/^\*\*Phase\*\*:\s*(F\d+)\b.*$/m);
  if (!head || head[1] !== phase) return null;
  const size = /\*\*Size\*\*:\s*(\w+)/.exec(head[0]);
  return { feature, size: size ? size[1] : 'Medium', dependsOn: [] };
}

const NEEDS_DESIGN = /^(large|complex)$/i;

/**
 * @param {{ feature: string, size: string }} row
 * @param {{ file: (name: string) => string|null, merged: boolean }} evidence
 */
export function featureState(row, { file, merged }) {
  const tasks = taskCount(file('tasks.md'));
  // Merged: done unless a task that is not waiting is still open (ADR 029: a box is a promise).
  if (merged) return { next: tasks.open - tasks.waiting > 0 ? 'execute' : 'done', tasks };
  if (file('spec.md') === null || file('acceptance.feature') === null) return { next: 'specify', tasks };
  if (NEEDS_DESIGN.test(row.size) && file('design.md') === null) return { next: 'design', tasks };
  if (file('tasks.md') === null || tasks.total === 0) return { next: 'tasks', tasks };
  if (tasks.done < tasks.total) return { next: 'execute', tasks };
  return { next: 'pr', tasks };
}

/**
 * @param {{ phase: string, brief: string|null, review: string|null, mergedToMain: boolean,
 *           specRows?: { feature: string, size: string, dependsOn: string[] }[],
 *           file: (feature: string, name: string) => string|null, merged: (feature: string) => boolean }} ev
 */
export function derivePhaseState(ev) {
  if (ev.brief === null) return { phase: ev.phase, next: 'kickoff', features: [], runnable: [] };
  // A phase that the brief's own features show closed (all merged, review approved, phase branch in main) stays
  // closed: discovered specs and old open boxes of features outside the brief never reopen it.
  if (ev.specRows?.length) {
    const declared = derivePhaseState({ ...ev, specRows: [] });
    if (declared.next === 'closed') return declared;
  }
  const inBrief = briefFeatures(ev.brief);
  const known = new Set(inBrief.map((r) => r.feature));
  const rows = [...inBrief, ...(ev.specRows ?? []).filter((r) => !known.has(r.feature))];
  const features = rows.map((row) => ({
    feature: row.feature,
    dependsOn: row.dependsOn,
    ...featureState(row, { file: (n) => ev.file(row.feature, n), merged: ev.merged(row.feature) }),
  }));
  const done = new Set(features.filter((f) => f.next === 'done').map((f) => f.feature));
  for (const f of features) f.waitingOn = f.dependsOn.filter((d) => !done.has(d));
  const runnable = features.filter((f) => f.next !== 'done' && f.waitingOn.length === 0);

  let next;
  if (!APPROVED.test(ev.brief)) next = 'awaiting-approval';
  else if (done.size < features.length) next = 'run';
  else if (ev.review === null || !APPROVED.test(ev.review)) next = 'review';
  else if (!ev.mergedToMain) next = 'merge';
  else next = 'closed';
  return { phase: ev.phase, next, features, runnable: next === 'run' ? runnable : [] };
}
