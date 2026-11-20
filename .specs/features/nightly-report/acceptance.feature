# Acceptance scenarios for nightly-report (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is a contributor at a clean checkout; steps read the nightly workflow and run the report
# script on fixture reports.
# not-scenario: NGT-01 — proved by the nightly-workflow harness test and a dispatched run of 40 minutes or less
# not-scenario: NGT-03 — proved by unit tests in scripts/nightly and the dispatched run's job summary
# not-scenario: NGT-04 — proved by unit tests on cargo-mutants and Stryker fixtures
# not-scenario: NGT-05 — proved by unit tests on a load summary fixture
# not-scenario: NGT-07 — proved by unit tests with and without a previous report
# not-scenario: NGT-08 — proved by the nightly-workflow harness test and the dispatched run
# not-scenario: NGT-09 — proved by a Rust unit test in the adapters
# not-scenario: NGT-10 — proved by pnpm test:harness

Feature: Every nightly says, in one report, how mutation, load and acceptance went
  The maintainer reads one report per run, and an agent can run the part it needs on its branch without waiting for
  the night.

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @NGT-02 @NFR-10
  Scenario: The nightly can be dispatched for one suite
    When the contributor reads the nightly workflow
    Then it can be dispatched with a "suites" input of "all", "mutation", "load" or "acceptance"
    And the scheduled run uses "all"

  @NGT-06 @NFR-10
  Scenario: The report lists every acceptance scenario, failures first
    Given an acceptance result with one failed and two passed scenarios
    When the contributor builds the nightly report from it
    Then the acceptance section lists the three scenarios with their tags
    And the failed scenario comes first
