import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeature } from '../lib/gherkin.mjs';
import { checkAcceptance, requirementIds, countScenarios } from '../lib/acceptance.mjs';

const SPEC = `# Spec

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ROOM-01 | P1: test room becomes Created | Design | Pending |
| ROOM-02 | P1: expiry | Design | Pending |
| PERF-01 | P2: latency | Design | Pending |
`;

const GOOD = `Feature: A test room becomes Created
  The walking skeleton proves every layer end to end.

  # not-scenario: PERF-01 — proven by the k6 load test (tests/load), NFR-01

  Background:
    Given a paired agent for "Player One"

  @ROOM-01 @FR-15 @INV-06 @web
  Scenario: The host's agent sees the expected game name
    Given a test room formed for "Player One" as host
    When the agent reports the game name "mmbaalh-1"
    Then the site shows the room as "Created" within 2 seconds

  @ROOM-02 @FR-17
  Scenario Outline: The room expires without the game
    Given a test room formed for "<host>" as host
    When <minutes> minutes pass without the expected game name
    Then the room is "<stage>"

    Examples:
      | host       | minutes | stage   |
      | Player One | 3       | Expired |
      | Player Two | 2       | Formed  |
`;

test('requirement IDs come from the traceability table', () => {
  assert.deepEqual(requirementIds(SPEC), ['ROOM-01', 'ROOM-02', 'PERF-01']);
  assert.deepEqual(requirementIds('# no table'), []);
});

test('parser: scenarios, outline examples, background, tags, not-scenario', () => {
  const f = parseFeature(GOOD);
  assert.deepEqual(f.errors, []);
  assert.equal(f.scenarios.length, 2);
  assert.equal(f.scenarios[1].outline, true);
  assert.equal(f.scenarios[1].examples, 2);
  assert.equal(f.backgroundSteps.length, 1);
  assert.deepEqual(f.scenarios[0].tags, ['@ROOM-01', '@FR-15', '@INV-06', '@web']);
  assert.deepEqual(f.notScenario, [
    { id: 'PERF-01', reason: 'proven by the k6 load test (tests/load), NFR-01' },
  ]);
  assert.equal(countScenarios(GOOD), 3);
});

test('a complete, English, tagged feature passes', () => {
  assert.deepEqual(checkAcceptance('api-web-skeleton', SPEC, GOOD), []);
});

test('missing file, uncovered requirement and unknown IDs fail', () => {
  assert.match(checkAcceptance('x', SPEC, null)[0], /missing/);
  const uncovered = GOOD.replace('@ROOM-02 @FR-17', '@FR-17');
  const errs = checkAcceptance('x', SPEC, uncovered);
  assert.ok(errs.some((e) => /ROOM-02 has no scenario/.test(e)));
  assert.ok(errs.some((e) => /tag it with the requirement ID/.test(e)));
  assert.ok(
    checkAcceptance('x', SPEC, GOOD.replace('@ROOM-01 ', '@ROOM-09 ')).some((e) =>
      /ROOM-09 is not a requirement/.test(e),
    ),
  );
});

test('skipped or focused scenarios, other languages and missing When/Then fail', () => {
  assert.ok(
    checkAcceptance('x', SPEC, GOOD.replace('@web', '@skip')).some((e) => /@skip is not allowed/.test(e)),
  );
  assert.ok(
    checkAcceptance('x', SPEC, GOOD.replace('@web', '@only')).some((e) => /@only is not allowed/.test(e)),
  );
  assert.ok(checkAcceptance('x', SPEC, `# language: pt\n${GOOD}`).some((e) => /English/.test(e)));
  const noThen = GOOD.replace('    Then the site shows the room as "Created" within 2 seconds\n', '');
  assert.ok(checkAcceptance('x', SPEC, noThen).some((e) => /needs a "Then"/.test(e)));
  const noExamples = GOOD.replace(/\n {4}Examples:[\s\S]*$/, '\n');
  assert.ok(checkAcceptance('x', SPEC, noExamples).some((e) => /without example rows/.test(e)));
  assert.ok(checkAcceptance('x', SPEC, GOOD.replace('@web', '@banana')).some((e) => /unknown tag/.test(e)));
});

test('a spec without traceability yet does not require scenarios', () => {
  assert.deepEqual(checkAcceptance('x', '# Spec\n', null), []);
});
