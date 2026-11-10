# Acceptance scenarios for continuous-delivery (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is the runner asking `scripts/phase-status.mjs` where the phase is, in a temporary git
# repository with an approved phase brief whose features are "alpha", "beta" and "gamma" (gamma depends on alpha).

Feature: The runner delivers through pull requests
  Features reach the phase branch through merged pull requests, the phase closes once its review exists and its branch
  is merged into main, and what still needs the maintainer blocks only the feature that needs it.

  # not-scenario: CDL-01 — an instruction of the phase-runner skill and `/phase-kickoff`; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-02 — an instruction of the skill's RUN section; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-03 — an instruction of the skill's Integrate step; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-05 — an instruction of the skill; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-06 — an instruction of the skill's REVIEW section; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-11 — template text; proved by `scripts/test/phase-runner-skill.test.mjs`, which reads the templates
  # not-scenario: CDL-12 — template text; proved by `scripts/test/phase-runner-skill.test.mjs`, which reads the templates
  # not-scenario: CDL-13 — guide text; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-14 — proved by the gate `pnpm test:harness` on the feature's head
  # not-scenario: CDL-15 — proved by the gate `pnpm contracts:check` on the feature's head
  # not-scenario: CDL-16 — an instruction of the skill's escalation step; proved by `scripts/test/phase-runner-skill.test.mjs`
  # not-scenario: CDL-18 — an instruction of the skill's Integrate step; proved by `scripts/test/phase-runner-skill.test.mjs`

  Background:
    Given a temporary repository with an approved phase brief for "F0" listing "alpha", "beta" and "gamma" after "alpha"

  @CDL-04 @NFR-11
  Scenario Outline: A feature is integrated only when its trailers reach the phase branch
    Given the feature "alpha" is verified on its branch
    When its branch reaches the phase branch through <how>
    Then phase-status reports the feature "alpha" as "<state>"

    Examples:
      | how                                  | state     |
      | a merge commit                       | done      |
      | a squash commit with no trailers     | integrate |

  @CDL-07 @NFR-11
  Scenario Outline: The phase closes once its review exists and its branch is in main
    Given every feature of the phase is done
    And the phase review exists <approval>
    When the agent asks phase-status for the phase
    Then the phase step is "merge"
    When the phase branch is merged into main
    And the agent asks phase-status for the phase
    Then the phase step is "closed"

    Examples:
      | approval                            |
      | with no approval line               |
      | with the maintainer's approval line |

  @CDL-07 @NFR-11
  Scenario: A phase whose features are done but has no review is at the review step
    Given every feature of the phase is done
    When the agent asks phase-status for the phase
    Then the phase step is "review"

  @CDL-17 @NFR-11
  Scenario: A phase merged on GitHub closes even when the local main is stale
    Given every feature of the phase is done
    And the phase review exists with no approval line
    When the phase branch is merged into origin/main only
    And the agent asks phase-status for the phase
    Then the phase step is "closed"

  @CDL-08 @NFR-11
  Scenario: An open maintainer item blocks only its feature
    Given the decisions file asks the maintainer "Create the TURSO_TOKEN secret" for the feature "alpha"
    When the agent asks phase-status for the phase
    Then the feature "alpha" is "blocked" with the reason "maintainer"
    And the feature "gamma" is "waiting"
    And the feature "beta" is "ready"

  @CDL-09 @NFR-11
  Scenario: phase-status shows each open maintainer item on its line
    Given the decisions file asks the maintainer "Create the TURSO_TOKEN secret" for the feature "alpha"
    And the decisions file asks the maintainer "Apply the main ruleset" for the feature "alpha"
    And the decisions file asks the maintainer "Pay for a larger runner" for the feature "omega"
    When the agent asks phase-status for the phase
    Then the line of the feature "alpha" shows "Create the TURSO_TOKEN secret"
    And the line of the feature "alpha" shows "Apply the main ruleset"
    And the phase line shows "Pay for a larger runner"

  @CDL-10 @NFR-11
  Scenario Outline: An answered maintainer item no longer blocks
    Given the decisions file asks the maintainer "Create the TURSO_TOKEN secret" for the feature "alpha"
    And the maintainer answered it "<answer>"
    When the agent asks phase-status for the phase
    Then the feature "alpha" is "<state>"

    Examples:
      | answer | state   |
      | done   | ready   |
      |        | blocked |
