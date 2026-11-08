// CRF-18 to CRF-23 (ci-and-review-fixes): the phase runner's instructions. The REVIEW and RUN sections are cut by their
// headings and read from the real files. A phase review reads the evidence instead of re-running the verification
// validator, which cannot pass on the phase branch (ADR 021).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = readFileSync(path.join(root, '.claude', 'skills', 'd2rmm-phase-runner', 'SKILL.md'), 'utf8');

// The text from a heading to the next level-2 heading, or to the end of the file for the last one.
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `the file has the heading ${heading}`);
  const next = text.slice(start + heading.length).search(/\n## /u);
  return next < 0 ? text.slice(start) : text.slice(start, start + heading.length + next);
};

// The text from one heading to the next heading of the same or a higher level.
const subsectionOf = (text, heading, nextHeading) => {
  const start = text.indexOf(heading);
  const end = text.indexOf(nextHeading, start);
  assert.ok(start >= 0 && end > start, `the file has ${heading} before ${nextHeading}`);
  return text.slice(start, end);
};

const REVIEW = sectionOf(skill, '## REVIEW');
const VERIFY = subsectionOf(sectionOf(skill, '## RUN'), '### 6. Verify', '### 7. Integrate');

// CRF-18: the review does not name the verification validator, so it never re-validates the proofs on the phase branch.
test('the review does not run the verification validator', () => {
  assert.doesNotMatch(REVIEW, /validate_verification\.py/u);
});

// CRF-19: the review reads the phase status and the retry budget of each feature instead.
test("the review reads the phase status and each feature's budget", () => {
  assert.ok(REVIEW.includes('pnpm phase:status'), 'the review runs pnpm phase:status');
  assert.ok(
    REVIEW.includes('node scripts/attempt.mjs status --feature'),
    'the review reads each feature budget',
  );
});

// CRF-20: a feature still runs the validator at its head, before its merge.
test('the verify step still runs the validator', () => {
  assert.match(VERIFY, /validate_verification\.py <feature>/u);
});

// CRF-21: the review produces the agent's mutation reports before the phase ratchet reads them.
test('the review produces the agent reports before the phase ratchet', () => {
  const mutation = REVIEW.indexOf('pnpm test:mutation:agent');
  const ratchet = REVIEW.indexOf('pnpm quality:ratchet --context phase');
  assert.ok(mutation >= 0, 'the review runs pnpm test:mutation:agent');
  assert.ok(ratchet >= 0, 'the review runs the phase ratchet');
  assert.ok(mutation < ratchet, 'the mutation run comes before the ratchet');
});

// CRF-22: the review template's mutation row names the agent's mutation command beside the API one.
test('the review template names the agent mutation command', () => {
  const template = readFileSync(
    path.join(root, '.claude', 'skills', 'd2rmm-phase-runner', 'references', 'templates', 'review.md'),
    'utf8',
  );
  const row = template
    .split('\n')
    .find((line) => line.startsWith('| mutation api domain / application / agent core'));
  assert.ok(row, 'the template has the mutation row');
  assert.ok(row.includes('`pnpm test:mutation`'), 'the row names the API mutation command');
  assert.ok(row.includes('`pnpm test:mutation:agent`'), 'the row names the agent mutation command');
});

// CRF-23: the commands table in AGENTS.md names the agent mutation command, where contributors look for commands.
test('the agent guide names the agent mutation command', () => {
  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const row = agents.split('\n').find((line) => line.startsWith('| Mutation (Stryker / cargo-mutants)'));
  assert.ok(row, 'AGENTS.md has the mutation row of the commands table');
  assert.ok(row.includes('`pnpm test:mutation`'), 'the row names the API mutation command');
  assert.ok(row.includes('`pnpm test:mutation:agent`'), 'the row names the agent mutation command');
});

// HBS-37 to HBS-42 (ADR 028): the guides, the escalation table and the brief template say what ADR 028 says.
const AGENTS = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const CLAUDE = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
const ESCALATION = readFileSync(
  path.join(root, '.claude', 'skills', 'd2rmm-phase-runner', 'references', 'escalation.md'),
  'utf8',
);
const BRIEF_TEMPLATE = readFileSync(
  path.join(root, '.claude', 'skills', 'd2rmm-phase-runner', 'references', 'templates', 'brief.md'),
  'utf8',
);

// HBS-37: rule 7 gives delivery to the runner and keeps the maintainer's blast radius with the maintainer.
test('rule 7 gives delivery to the runner', () => {
  const rule = subsectionOf(AGENTS, '\n7. **', '\n8. **');
  for (const phrase of [
    'ADR 028',
    'git push',
    'pull requests',
    'merges',
    'releases',
    'tags',
    'workflow runs',
  ]) {
    assert.ok(rule.includes(phrase), `rule 7 names "${phrase}"`);
  }
  for (const phrase of ['secrets', 'production database', 'repository settings', 'rulesets', 'money']) {
    assert.ok(rule.includes(phrase), `rule 7 keeps "${phrase}" with the maintainer`);
  }
});

// HBS-38: rule 8 keeps briefs, brief revisions and ADRs with the maintainer.
test('rule 8 keeps briefs and ADRs with the maintainer', () => {
  const rule = subsectionOf(AGENTS, '\n8. **', '\n9. **');
  for (const phrase of ['brief', 'brief revision', 'ADR']) {
    assert.ok(rule.includes(phrase), `rule 8 names "${phrase}"`);
  }
});

// HBS-39: the escalation item of the phase workflow names no delivery.
test('the phase workflow lists no delivery escalation', () => {
  const item = subsectionOf(AGENTS, '\n5. **Escalations', '\n6. **Review');
  assert.doesNotMatch(item, /push|merge to|deploy/iu);
});

// HBS-40: the runner never says "never push", and its escalation summary names no delivery.
test('the runner never says never push', () => {
  const skill = readFileSync(path.join(root, '.claude', 'skills', 'd2rmm-phase-runner', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /never push/iu);
  const summary = subsectionOf(skill, '## Escalations', '## REVIEW');
  assert.doesNotMatch(summary, /push or merge to|deploy;/u);
});

// HBS-41: the escalation table holds no delivery row and names the repository settings, rulesets and harness-self.
const ESCALATION_CELLS = ESCALATION.split('\n')
  .filter((line) => line.startsWith('|'))
  .slice(2)
  .map((line) => line.split('|')[1].trim());

test('the escalation table matches ADR 028', () => {
  for (const cell of ESCALATION_CELLS) {
    assert.doesNotMatch(
      cell,
      /push|PR merge|merge into|deploy|release|tag/iu,
      `"${cell}" is not a delivery row`,
    );
  }
  for (const phrase of ['repository settings', 'rulesets', 'harness-self']) {
    assert.ok(
      ESCALATION_CELLS.some((cell) => cell.includes(phrase)),
      `a row of the escalation table names "${phrase}"`,
    );
  }
});

// HBS-42: the Claude guide names harness-self and the hook file that records the security-reviewer verdict.
test('CLAUDE.md names harness-self and the verdict hook', () => {
  assert.match(CLAUDE, /harness-self/u);
  assert.ok(CLAUDE.includes('.claude/hooks/verdict.mjs'), 'CLAUDE.md names the verdict hook file');
});

// HBS-24: the brief template lists harness-self unticked, names feature rows in backticks and points to ADR 028.
test('the brief template offers harness-self', () => {
  const delegation = subsectionOf(BRIEF_TEMPLATE, '## Delegation', '## Approval');
  const line = delegation.split('\n').find((text) => text.startsWith('- [ ] harness-self'));
  assert.ok(line, 'harness-self is listed and unticked');
  assert.match(line, /`[^`]+`/u, 'the line names the feature rows in backticks');
  assert.ok(line.includes('ADR 028'), 'the line points to ADR 028');
});

// GPR-19: both guides tell the agent to wait for the task notification of long work, and never to poll for it.
test('the guides say to wait for the notification', () => {
  const worker = readFileSync(path.join(root, '.claude', 'agents', 'feature-worker.md'), 'utf8');
  for (const [name, text] of [
    ['feature-worker.md', worker],
    ['SKILL.md', skill],
  ]) {
    assert.match(text, /wait for its task notification/u, `${name} says to wait for the task notification`);
    assert.match(text, /never poll with `sleep` or status loops/u, `${name} says never to poll`);
  }
});
