// Structural checks for .specs/ that TLC's own scripts do not cover: phase delegation (ADR 021).
import { approvalsIn, delegatedScopes } from '../../.claude/hooks/lib/delegation.mjs';

const DELEGATED_RE = /\(delegated via (\.specs\/phases\/F\d+\/brief\.md)\)/;
const ASSUMED_RE = /^#{2,4}\s*(AD-\d{3})\b.*\bassumed\b/i;
const TASK_HEADER_RE = /^#{2,4}\s+(T\d+)\s*:/;
const MUTATION_GATE_RE = /test:mutation|cargo mutants|cargo-mutants/;

/**
 * The tasks of a tasks.md, each with its gate and whether it is open: a task is open while one `Done when` box is unticked
 * (ADR 023, CFP-11, CFP-12). Other headings and bold labels end the task's sections.
 * @param {string} text
 * @returns {{ id: string, gate: string, open: boolean }[]}
 */
export function taskGates(text) {
  const tasks = [];
  let current = null;
  let inDone = false;
  for (const line of String(text ?? '').split('\n')) {
    const header = TASK_HEADER_RE.exec(line);
    if (header) {
      current = { id: header[1].toUpperCase(), gate: '', open: false };
      tasks.push(current);
      inDone = false;
    } else if (/^#{1,4}\s/.test(line)) {
      current = null;
      inDone = false;
    } else if (current) {
      const gate = /^\*\*Gate\*\*:\s*(.*)$/.exec(line);
      if (gate) {
        current.gate = gate[1];
        inDone = false;
      } else if (/^\*\*Done when\*\*/.test(line)) {
        inDone = true;
      } else if (/^\*\*/.test(line)) {
        inDone = false;
      } else if (inDone && /^\s*- \[ \]/.test(line)) {
        current.open = true;
      }
    }
  }
  return tasks;
}

/**
 * @param {(rel: string) => string|null} read
 * @param {(dir: string) => string[]} list  entries (names) of a directory, [] when missing
 * @returns {string[]} errors
 */
export function checkSpecs(read, list) {
  const errors = [];
  const state = read('.specs/STATE.md');
  if (state === null) errors.push('.specs/STATE.md is missing (TLC project memory).');

  const active = (read('.specs/phases/ACTIVE') ?? '').trim();
  let brief = null;
  if (active) {
    if (!/^F\d+$/.test(active))
      errors.push(`.specs/phases/ACTIVE must hold a phase id like F0 (found "${active}").`);
    brief = read(`.specs/phases/${active}/brief.md`);
    if (brief === null) errors.push(`.specs/phases/${active}/brief.md is missing for the active phase.`);
    if (read(`.specs/phases/${active}/decisions.md`) === null) {
      errors.push(
        `.specs/phases/${active}/decisions.md is missing (queue of assumed decisions for the phase review).`,
      );
    }
  }

  for (const feature of list('.specs/features')) {
    for (const doc of ['spec.md', 'tasks.md']) {
      const rel = `.specs/features/${feature}/${doc}`;
      const text = read(rel);
      if (text === null) continue;
      for (const a of approvalsIn(text)) {
        const m = DELEGATED_RE.exec(a.line);
        if (!m) continue; // a direct approval by the maintainer
        const b = read(m[1]);
        if (b === null) {
          errors.push(`${rel}: cites ${m[1]}, which does not exist.`);
          continue;
        }
        const words = approvalsIn(b).map((x) => x.words);
        if (!words.includes(a.words))
          errors.push(`${rel}: delegated approval does not quote the kickoff approval in ${m[1]} verbatim.`);
        if (!delegatedScopes(b).has('specs-and-tasks'))
          errors.push(`${rel}: ${m[1]} does not delegate specs-and-tasks.`);
        const phaseId = /phases\/(F\d+)\//.exec(m[1])[1];
        if (!new RegExp(`\\b${feature}\\b`).test(b))
          errors.push(`${rel}: feature "${feature}" is not listed in the ${phaseId} brief.`);
      }
    }
  }

  // CFP-11: an open task never runs mutation in its gate; mutation belongs to the PR jobs, the nightly and the Verifier.
  for (const feature of list('.specs/features')) {
    const rel = `.specs/features/${feature}/tasks.md`;
    const text = read(rel);
    if (text === null) continue;
    for (const task of taskGates(text)) {
      if (task.open && MUTATION_GATE_RE.test(task.gate)) {
        errors.push(
          `${rel}: feature "${feature}" task ${task.id} is open and its gate runs mutation; mutation is not a task gate (CFP-11).`,
        );
      }
    }
  }

  if (state && active) {
    const queue = read(`.specs/phases/${active}/decisions.md`) ?? '';
    for (const line of state.split('\n')) {
      const m = ASSUMED_RE.exec(line.trim());
      if (m && !queue.includes(m[1])) {
        errors.push(
          `${m[1]} is marked assumed in STATE.md but missing from .specs/phases/${active}/decisions.md.`,
        );
      }
    }
  }
  return errors;
}
