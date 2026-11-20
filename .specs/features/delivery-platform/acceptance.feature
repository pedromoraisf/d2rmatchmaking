# Acceptance scenarios for delivery-platform (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: DLP-01 — an ADR and a runbook; proved by review
# not-scenario: DLP-02 — proved by the harness tests on the reusable workflows and their callers
# not-scenario: DLP-03 — proved by the harness tests (no build step in deploy or promote jobs) and the run links
# not-scenario: DLP-05 — proved by the two health answers of staging and production and the render.yaml harness test
# not-scenario: DLP-06 — proved by Rust unit tests on the channel config, the agent-build harness test and a PR artifact
# not-scenario: DLP-08 — proved by a unit test on the alias rule and the maintainer's check at Blizzard
# not-scenario: DLP-09 — proved by the PR descriptions (three run links per replaced workflow)
# not-scenario: DLP-10 — proved by pnpm test:harness

Feature: Every environment says which build it runs, and a sleeping server is not an error
  The maintainer can tell, for any environment, which commit answers; a player who arrives while the free server sleeps
  sees it waking instead of an error.

  @DLP-04 @NFR-09 @api
  Scenario: The API answers its health with the build it runs
    When anyone asks the API for its health
    Then it answers that it is ok, with the commit of the running build

  @DLP-07 @NFR-07 @web
  Scenario: The site waits for a sleeping server instead of failing
    Given the API answers 502 for the first 20 seconds, then answers normally
    When a player opens the site
    Then the site says the server is waking up
    And the site loads normally once the API answers
