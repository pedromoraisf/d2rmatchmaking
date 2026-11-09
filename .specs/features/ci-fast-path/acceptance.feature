# Acceptance scenarios for ci-fast-path (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is a contributor at a clean checkout; steps read the repository's workflow, ruleset and
# Dependabot files, and run the specs check on a temporary copy of the .specs tree.

Feature: The required checks are fast and mutation runs beside them
  Mutation leaves the PR critical path and the task loop, the ruleset requires every check that guards main, and a PR
  shows whether the production builds still start.

  # not-scenario: CFP-03 — which files Stryker mutates is a pure rule over a file list; proved by a unit test colocated with the API's mutation plan
  # not-scenario: CFP-04 — the summary of a run with nothing to mutate is written by the job's script; proved by the same unit test file
  # not-scenario: CFP-06 — the summary of survived mutants is a pure function over a Stryker report; proved by a unit test colocated with it
  # not-scenario: CFP-16 — the 30-second wait is a rule of the smoke script; proved by a unit test colocated with it
  # not-scenario: CFP-23 — proved by the gate `pnpm contracts:check` on the feature's head

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @CFP-01 @CFP-07 @NFR-10
  Scenario: Mutation is not on the critical path
    When the contributor reads the CI workflow
    Then the verify job does not run "test:mutation"
    And the integration job needs exactly "detect" and "verify"

  @CFP-02 @CFP-05 @NFR-10
  Scenario: The API's mutation runs in its own job on pull requests
    When the contributor reads the CI workflow
    Then a job "mutation" needs only "detect"
    And it runs only on pull requests and only when the detect job reports a Stryker configuration
    And it restores and saves the Stryker incremental files under a key that starts with the base branch

  @CFP-08 @CFP-09 @NFR-10
  Scenario: The agent's mutation of a PR's diff runs in its own job
    When the contributor reads the CI workflow
    Then a job "agent-mutation" needs only "detect" and runs only on pull requests
    And it runs cargo mutants on the PR's diff for the domain, the core and the adapters, each with unit tests only
    And its cargo mutants commands run only when the PR changes a file under "apps/agent/src-tauri/"

  @CFP-10 @NFR-10
  Scenario: The nightly agent mutation runs on Linux
    When the contributor reads the nightly workflow
    Then the agent mutation job runs on "ubuntu-latest"
    And its three cargo mutants commands and report paths are the ones it had before

  @CFP-11 @NFR-10
  Scenario Outline: The specs check refuses an open task whose gate runs mutation
    Given a copy of the specs tree where feature "demo" has an open task "T2" whose gate is "<gate>"
    When the contributor runs the specs check on that copy
    Then the check fails
    And the failure names "demo" and "T2"

    Examples:
      | gate                                                                          |
      | pnpm test:mutation                                                            |
      | pnpm test:mutation:agent                                                      |
      | cargo mutants --package d2rmm-agent-core -- --lib                             |
      | node --test x.test.mjs && cargo-mutants --package d2rmm-agent-domain -- --lib |

  @CFP-11 @NFR-10
  Scenario: A task with some boxes ticked and one open is still open
    Given a copy of the specs tree where feature "demo" has a task "T2" with one box ticked and one open whose gate is "pnpm test:mutation"
    When the contributor runs the specs check on that copy
    Then the check fails
    And the failure names "demo" and "T2"

  @CFP-12 @NFR-10
  Scenario Outline: A done task's gate, or a gate with no mutation, is not flagged
    Given a copy of the specs tree where feature "demo" has <task> "T2" whose gate is "<gate>"
    When the contributor runs the specs check on that copy
    Then the check passes

    Examples:
      | task        | gate                                  |
      | a done task | pnpm test:mutation                    |
      | an open task | node --test scripts/test/x.test.mjs  |

  @CFP-13 @CFP-14 @NFR-11
  Scenario: The ruleset requires the four checks that guard main
    When the contributor reads the ruleset of main
    Then its required checks are exactly "verify", "integration", "agent" and "secrets"
    And none of "mutation", "agent-mutation", "smoke" and "agent-build" is required

  @CFP-15 @CFP-18 @CFP-19 @CFP-25 @NFR-11
  Scenario: A PR boots the API the way Render does
    When the contributor reads the CI workflow
    Then a job "smoke" runs on pull requests with a Postgres service container
    And it installs the workspace, runs the migrations and starts the API with the commands of "render.yaml" and "deploy-api.yml"
    And it requests "/healthz"
    And none of the new jobs reads a repository secret
    And every action of the new jobs outside "actions/" is pinned by a full commit SHA

  @CFP-17 @NFR-11
  Scenario: A PR that changes the agent compiles its release build
    When the contributor reads the CI workflow
    Then a job "agent-build" runs on a Windows runner on pull requests that change a file under "apps/agent/"
    And it runs "tauri build" with no signing key in its environment

  @CFP-20 @CFP-21 @CFP-22 @NFR-11
  Scenario: Majors of the lint and telemetry families arrive grouped and late
    When the contributor reads the Dependabot configuration
    Then major npm updates of the eslint family form one group and those of "@opentelemetry/*" another
    And a major update of "eslint" lands in the eslint group, not in "dev-tooling", taking the first group that matches
    And a cooldown holds semver-major updates of those packages for 30 days
    And the npm schedule is still weekly with the "playwright" and "dev-tooling" groups unchanged

  @CFP-24 @NFR-11
  Scenario: The verify job keeps every other sensor
    When the contributor reads the CI workflow
    Then the verify job still runs format, lint, typecheck, architecture, unit tests, the TLC self-test, the specs check, the contracts check, the harness gate and the PR ratchet
