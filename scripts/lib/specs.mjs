// Structural checks for .specs/ that TLC's own scripts do not cover: phase delegation (ADR 021).
import { approvalsIn, delegatedScopes } from '../../.claude/hooks/lib/delegation.mjs';

const DELEGATED_RE = /\(delegated via (\.specs\/phases\/F\d+\/brief\.md)\)/;
const ASSUMED_RE = /^#{2,4}\s*(AD-\d{3})\b.*\bassumed\b/i;

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
