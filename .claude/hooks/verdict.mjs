#!/usr/bin/env node
// PostToolUse hook for subagent dispatches (ADR 028 § 3). Records the verdict of a security review of a diff that the
// gate noted at its start (HBS-26 to HBS-28). Registered in .claude/settings.json for `Agent|Task`.
// Fails closed: on any error nothing is recorded, and an absent verdict is a missing proof for the merge guard.
import { readStdinJson, projectDir, makeRepoContext } from './lib/io.mjs';
import { recordVerdict, applyVerdictEffect } from './lib/verdicts.mjs';
import { verdictsPath, withVerdicts } from './lib/verdict-store.mjs';

const input = await readStdinJson();
const root = projectDir(input);
try {
  const ctx = makeRepoContext(root);
  withVerdicts(verdictsPath(root), (store) => {
    const effect = recordVerdict(input, { ...ctx, verdicts: store });
    if (effect) applyVerdictEffect(store, effect);
  });
} catch {
  // Nothing recorded: the verdict stays absent.
}
process.exit(0);
