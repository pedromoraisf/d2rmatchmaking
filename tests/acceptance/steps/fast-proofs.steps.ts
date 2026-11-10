// Acceptance steps for fast-proofs (ADR 023), one step per line of acceptance.feature that is not a not-scenario. Black
// box: the steps read the phase runner's guide from the repository and check the text of its Verify step (§ 6). Nothing
// here imports scripts/lib or apps/ (rule acceptance-is-black-box).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Then, When, type Scenario } from '../fixtures.ts';

const OWN_KEY = 'fast-proofs';
const VERIFY_HEADING = '### 6. Verify';
const INTEGRATE_HEADING = '### 7. Integrate';

interface OwnWorld {
  guide?: string;
}

function own(scenario: Scenario): OwnWorld {
  const stored = scenario.values.get(OWN_KEY);
  if (stored !== undefined) return stored as OwnWorld;
  const created: OwnWorld = {};
  scenario.values.set(OWN_KEY, created);
  return created;
}

// The Verify step of the guide: from its heading to the Integrate step.
function verifyStepOf(scenario: Scenario): string {
  const guide = own(scenario).guide;
  if (guide === undefined) throw new Error('the runner guide has not been read in this scenario');
  const start = guide.indexOf(VERIFY_HEADING);
  const end = guide.indexOf(INTEGRATE_HEADING);
  expect(start, 'the Verify step heading of the guide').toBeGreaterThanOrEqual(0);
  expect(end, 'the Integrate step heading of the guide').toBeGreaterThan(start);
  return guide.slice(start, end);
}

// The wrapper command of the Verify step that runs the script as the given step: the one line that names both.
function wrapperLineOf(verify: string, script: string, step: string): string | undefined {
  return verify
    .split('\n')
    .find(
      (line) =>
        line.includes('node scripts/attempt.mjs run') &&
        line.includes(script) &&
        line.includes(`--step ${step} `),
    );
}

When('the maintainer reads {string}', ({ scenario }, file: string) => {
  own(scenario).guide = readFileSync(path.join(scenario.repoRoot, file), 'utf8');
});

// FPR-07: the fix loop runs the preflight through the wrapper as step fix.
Then(
  'its Verify step runs {string} through the wrapper as step {string}',
  ({ scenario }, script: string, step: string) => {
    expect(
      wrapperLineOf(verifyStepOf(scenario), script, step),
      `the Verify step runs ${script} through the wrapper as step ${step}`,
    ).toBeDefined();
  },
);

// FPR-07: the official proofs run as step proofs once, when the preflight is green, and a second time only if that run fails.
Then(
  'it runs {string} as step {string} once, when the preflight is green, and again only if that run fails',
  ({ scenario }, script: string, step: string) => {
    const verify = verifyStepOf(scenario);
    expect(
      wrapperLineOf(verify, script, step),
      `the Verify step runs ${script} through the wrapper as step ${step}`,
    ).toBeDefined();
    expect(verify, 'the official run waits for a green preflight').toContain(
      'once, when the preflight is green',
    );
    expect(verify, 'the second official run follows a failed run only').toMatch(
      /a second time only if that run fails/u,
    );
  },
);
