#!/usr/bin/env node
// PostToolUse feedback hook: runs fast sensors on the edited file and feeds failures back.
// Exit 2 + stderr → Claude Code shows the errors to the agent, which fixes them in the same loop.
// Missing tools (before `pnpm install`) are skipped, never treated as failures.
import { existsSync } from 'node:fs';
import { readStdinJson, projectDir, toRelative, bin, run, tail } from './lib/io.mjs';
import { planFeedback, reminders } from './lib/feedback-plan.mjs';

const input = await readStdinJson();
const root = projectDir(input);
const ti = input.tool_input ?? {};
const rel = toRelative(root, ti.file_path ?? ti.notebook_path ?? '');
if (!rel || !existsSync(`${root}/${rel}`)) process.exit(0);

const which = (name) => run(process.platform === 'win32' ? 'where' : 'which', [name]).ok;
const has = (name) => (['python3', 'rustfmt'].includes(name) ? which(name) : bin(root, name) !== null);
const failures = [];
for (const step of planFeedback(rel, has)) {
  const exe = step.cmd === 'node' || step.cmd === 'python3' || step.cmd === 'rustfmt' ? step.cmd : bin(root, step.cmd);
  const r = run(exe, step.args, { cwd: root, timeoutMs: step.timeoutMs ?? 90_000 });
  if (!r.ok && !step.fix) failures.push(`## ${step.id} failed on ${rel}\n${tail(r.out, 40)}`);
}

if (failures.length > 0) {
  process.stderr.write(`[d2rmm feedback] Fix these before moving on:\n\n${failures.join('\n\n')}\n`);
  process.exit(2);
}
const notes = reminders(rel);
if (notes.length > 0) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }),
  );
}
process.exit(0);
