// HBS-09 (ADR 028 § 1 and § 3): the settings stop asking for push, PR merge and release, keep asking for secrets, and
// register the verdict hook on subagent dispatches. The file is read as it is committed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));

// HBS-09: the delivery asks are gone; the secret ask stays.
test('stops asking for push, PR merge and release', () => {
  const ask = settings.permissions.ask;
  assert.ok(
    ask.some((rule) => rule.startsWith('Bash(gh secret')),
    'gh secret still asks',
  );
  for (const command of ['git push', 'gh pr merge', 'gh release']) {
    const asked = ask.filter((rule) => rule.startsWith(`Bash(${command}`));
    assert.deepEqual(asked, [], `${command} no longer asks`);
  }
});

// HBS-09: the verdict hook reads the reviewer's report when a subagent returns.
test('registers the verdict hook for subagent dispatches', () => {
  const entries = settings.hooks.PostToolUse.filter((entry) => entry.matcher === 'Agent|Task');
  const commands = entries.flatMap((entry) => entry.hooks.map((hook) => hook.command));
  assert.deepEqual(commands, ['node ${CLAUDE_PROJECT_DIR}/.claude/hooks/verdict.mjs']);
});
