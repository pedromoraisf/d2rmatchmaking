#!/usr/bin/env node
// PostToolUse feedback hook: runs fast sensors on the edited file and feeds failures back.
// Exit 2 + stderr → Claude Code shows the errors to the agent, which fixes them in the same loop.
// Missing tools (before `pnpm install`) are skipped, never treated as failures.
import { existsSync } from 'node:fs';
import { readStdinJson, projectDir, toRelative, bin, run, tail } from './lib/io.mjs';
import { planFeedback, reminders } from './lib/feedback-plan.mjs';
import { onFeedback } from './lib/budget-rules.mjs';
import { sessionId, MAX_ATTEMPTS, MAX_RETRIES } from '../../scripts/lib/budget.mjs';
import { ledgerPath, withLedger } from '../../scripts/lib/ledger-store.mjs';

const input = await readStdinJson();
const root = projectDir(input);
const ti = input.tool_input ?? {};
const rel = toRelative(root, ti.file_path ?? ti.notebook_path ?? '');
if (!rel || !existsSync(`${root}/${rel}`)) process.exit(0);

const which = (name) => run(process.platform === 'win32' ? 'where' : 'which', [name]).ok;
const has = (name) => (['python3', 'rustfmt'].includes(name) ? which(name) : bin(root, name) !== null);
const failures = [];
const results = [];
for (const step of planFeedback(rel, has)) {
  const exe = step.cmd === 'node' || step.cmd === 'python3' || step.cmd === 'rustfmt' ? step.cmd : bin(root, step.cmd);
  const r = run(exe, step.args, { cwd: root, timeoutMs: step.timeoutMs ?? 90_000 });
  if (step.fix) continue;
  results.push({ id: step.id, ok: r.ok, out: tail(r.out, 10) });
  if (!r.ok) failures.push(`## ${step.id} failed on ${rel}\n${tail(r.out, 40)}`);
}
const blocked = withLedger(ledgerPath(root), (l) => onFeedback(l, sessionId(input), rel, results));

if (blocked.length > 0) {
  process.stderr.write(
    `[d2rmm feedback] ${blocked.join(', ')} failed ${MAX_ATTEMPTS} times in a row (${MAX_RETRIES} retries used): retry budget ` +
      'exhausted. Stop editing; record the blocker in .specs/ (tasks.md "## Handoff", phase decisions.md "Blocked") and report back.\n\n' +
      failures.join('\n\n'),
  );
  process.exit(2);
}
if (failures.length > 0) {
  process.stderr.write(`[d2rmm feedback] Fix these before moving on (each sensor/file allows ${MAX_RETRIES} retries):\n\n${failures.join('\n\n')}\n`);
  process.exit(2);
}
const notes = reminders(rel);
if (notes.length > 0) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }),
  );
}
process.exit(0);
