#!/usr/bin/env node
// PreToolUse gate hook. Registered in .claude/settings.json for Bash and file-editing tools.
// Fails closed on its own bugs for risky tools: an exception becomes "ask", never a silent allow.
import { readStdinJson, projectDir, makeRepoContext, toRelative } from './lib/io.mjs';
import { decide } from './lib/gate-rules.mjs';

const input = await readStdinJson();
let result;
try {
  result = decide(input, makeRepoContext(projectDir(input)), toRelative);
} catch (err) {
  result = { decision: 'ask', reason: `Gate hook error (${err?.message ?? err}). Asking instead of allowing.` };
}

if (result) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: `[d2rmm gate] ${result.reason}`,
      },
    }),
  );
}
process.exit(0);
