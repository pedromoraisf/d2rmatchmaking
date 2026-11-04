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
