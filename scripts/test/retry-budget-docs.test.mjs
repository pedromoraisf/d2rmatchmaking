// BUD-22, BUD-23: the guides say what the retry budget counts (ADR 028 § 4). Reads the files; no code is run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const reference = readFileSync(
  new URL('../../.claude/skills/d2rmm-phase-runner/references/retry-budget.md', import.meta.url),
  'utf8',
);

// Rule 11 of AGENTS.md's "Inviolable rules", from its line to the line of rule 12, with whitespace folded.
const rules = agents.slice(agents.indexOf('## Inviolable rules'));
const rule11 = rules.slice(rules.indexOf('\n11. ') + 1, rules.indexOf('\n12. ')).replace(/\s+/g, ' ');

test('rule 11 says what the budget counts', () => {
  assert.match(rule11, /Environment failures .*do not count/);
  assert.match(rule11, /unchanged reruns?.*do not count/);
  assert.match(rule11, /resets a unit once, with a reason/);
  assert.match(rule11, /a second reset .*maintainer/);
});

test('the reference describes budget v2', () => {
  // The signatures of BUD-01, by name.
  for (const name of ['docker', 'disk', 'killed', 'port', 'not-found', 'timeout']) {
    assert.match(reference, new RegExp(`\`${name}\``), `signature ${name}`);
  }
  assert.match(reference, /`env-blocked`/);
  assert.match(reference, /exit 4/);
  assert.match(reference, /--by orchestrator/);
  assert.match(reference, /reports\/attempts\/<unit>\/<n>\.log/);
  for (const filter of ['tail -n', 'head -n', 'grep']) {
    assert.ok(reference.includes(filter), `filter ${filter}`);
  }
});
