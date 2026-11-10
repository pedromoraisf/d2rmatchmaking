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
  # not-scenario: CFP-02 — superseded by ADR 029: mutation runs in the nightly only, no PR job mutates
  # not-scenario: CFP-05 — superseded by ADR 029: mutation runs in the nightly only, no PR job mutates
  # not-scenario: CFP-08 — superseded by ADR 029: mutation runs in the nightly only, no PR job mutates
  # not-scenario: CFP-09 — superseded by ADR 029: mutation runs in the nightly only, no PR job mutates
  # not-scenario: CFP-11 — superseded by ADR 029: the specs check no longer reads task gates
  # not-scenario: CFP-12 — superseded by ADR 029: the specs check no longer reads task gates

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @CFP-01 @CFP-07 @NFR-10
  Scenario: Mutation is not on the critical path
    When the contributor reads the CI workflow
    Then the verify job does not run "test:mutation"
    And the integration job needs exactly "detect" and "verify"

  @CFP-10 @NFR-10
  Scenario: The nightly agent mutation runs on Linux
    When the contributor reads the nightly workflow
    Then the agent mutation job runs on "ubuntu-latest"
    And its three cargo mutants commands and report paths are the ones it had before

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
    Then the verify job still runs format, lint, typecheck, architecture, unit tests, the specs check, the contracts check and the PR ratchet
