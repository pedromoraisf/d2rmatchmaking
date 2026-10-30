// Commit trailers that make progress durable in git history (ADR 024).
// On a feature branch `feat/F<n>-<feature>` every commit carries:
//   Feature: <feature>
//   Task: T<n>        (a task id declared in tasks.md)   — or —
//   Step: spec|design|tasks|proofs|verification|integration|fix
import { parseTrailers } from './phase-state.mjs';
import { FIXED_STEPS } from './budget.mjs';

const BRANCH = /^feat\/(F\d+)-(.+)$/;
const STEPS = new Set([...FIXED_STEPS, 'fix']);

/** @returns {string[]} errors (empty = ok). */
export function checkTrailers(branch, message, taskIdsOfFeature) {
  const m = BRANCH.exec(branch ?? '');
  if (!m) return [];
  const feature = m[2];
  const t = parseTrailers(message);
  const errors = [];
  if (t.feature !== feature) errors.push(`add the trailer "Feature: ${feature}"`);
  if (!t.task && !t.step) errors.push('add "Task: T<n>" (a task from tasks.md) or "Step: <spec|design|tasks|proofs|verification|integration|fix>"');
  if (t.task && !taskIdsOfFeature.includes(t.task.toUpperCase())) {
    errors.push(`"Task: ${t.task}" is not a task id in .specs/features/${feature}/tasks.md`);
  }
  if (t.step && !STEPS.has(t.step)) errors.push(`"Step: ${t.step}" is not a known step`);
  return errors;
}
