#!/usr/bin/env node
// PreToolUse gate hook. Registered in .claude/settings.json for Bash, file-editing and subagent tools.
// Fails closed on its own bugs: an exception becomes "ask", never a silent allow.
// Also applies retry-budget effects (ADR 022) to the shared ledger in .git/d2rmm/ledger.json.
import { readStdinJson, projectDir, makeRepoContext, toRelative } from './lib/io.mjs';
import { decide } from './lib/gate-rules.mjs';
import { recordAttempt, recordDispatch } from '../../scripts/lib/budget.mjs';
import { ledgerPath, loadLedger, withLedger } from '../../scripts/lib/ledger-store.mjs';

const input = await readStdinJson();
const root = projectDir(input);
let result;
try {
  const ctx = makeRepoContext(root);
  const file = ledgerPath(root);
  ctx.ledger = loadLedger(file, root);
  result = decide(input, ctx, toRelative);
  if (result?.effects?.length) {
    withLedger(file, (ledger) => {
      for (const e of result.effects) {
        if (e.op === 'fail') recordAttempt(ledger, e.key, false, { note: e.note });
        if (e.op === 'dispatch') recordDispatch(ledger, e.key, { note: e.note });
      }
    });
  }
} catch (err) {
  result = { decision: 'ask', reason: `Gate hook error (${err?.message ?? err}). Asking instead of allowing.` };
}

if (result?.decision) {
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
