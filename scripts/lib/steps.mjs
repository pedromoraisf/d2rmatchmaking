// Which step names a feature may spend retry budget on (ADR 022): the task ids declared in its tasks.md
// (TLC format "### T3: …") plus the fixed steps. An agent cannot invent "T3b" to get a fresh budget.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXED_STEPS } from './budget.mjs';

const TASK_RE = /^#{2,4}\s+(T\d+)\s*:/gim;

export function taskIds(tasksText) {
  return [...String(tasksText ?? '').matchAll(TASK_RE)].map((m) => m[1].toUpperCase());
}

export function allowedSteps(featureDir) {
  const tasks = path.join(featureDir, 'tasks.md');
  return new Set([...FIXED_STEPS, ...taskIds(existsSync(tasks) ? readFileSync(tasks, 'utf8') : '')]);
}
