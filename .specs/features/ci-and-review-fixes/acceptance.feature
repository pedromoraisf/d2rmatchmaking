# Acceptance scenarios for ci-and-review-fixes (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is a contributor at a clean checkout; steps read the repository's own files and commands.

Feature: The harness reads what the repository really produces
  A contributor can run the acceptance suite from a fresh checkout, the ratchet reads the agent's real mutation score,
  and a phase review no longer spends budget on a check that cannot pass on the phase branch.

  # not-scenario: CRF-02 — a scenario cannot start the acceptance run from inside it; proved by a task gate that removes `apps/web/dist` and runs `pnpm test:acceptance` with one scenario, and by CRF-01's plan
  # not-scenario: CRF-05 — the score is a pure rule over a fixture; proved by a unit test in `scripts/test/collect.test.mjs` that writes outcomes at the baseline's source path in a temporary root and calls `collect`
  # not-scenario: CRF-08 — the same rule on an absent and an empty report; proved by unit tests in `scripts/test/collect.test.mjs`
  # not-scenario: CRF-29 — a mutation run takes minutes, beyond a scenario, and rule 12 keeps mutation against unit tests; proved by the gate of T10, which runs cargo-mutants on the adapters

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @CRF-01 @NFR-11
  Scenario: The acceptance run builds the site it serves
    When the contributor asks turbo for the plan of the acceptance run
    Then the plan runs the site build before the acceptance run

  @CRF-03 @NFR-11
  Scenario: The CI job runs acceptance through the same command
    When the contributor reads the CI workflow
    Then the integration job runs "pnpm run test:acceptance"

  @CRF-04 @CRF-06 @CRF-07 @NFR-10
  Scenario: The ratchet reads the agent's mutation report where cargo-mutants writes it
    When the contributor reads the source of the agent core's mutation metric
    Then it is the outcomes file inside the directory the nightly writes for the agent core
    And the metric still has direction higher, floor 70 and tolerance 0.02
    And the metric is still enforced in the nightly and phase contexts

  @CRF-09 @CRF-10 @CRF-11 @NFR-10
  Scenario: One command produces the agent's mutation reports from unit tests only
    When the contributor reads the agent mutation command
    Then it runs the domain, the core and the adapters
    And each of them uses unit tests only
    And each of them writes to the report path the nightly uses

  @CRF-12 @CRF-13 @NFR-10
  Scenario: The nightly ratchet waits for the agent's mutation job and does not depend on its success
    When the contributor reads the nightly workflow
    Then the quality job needs the agent mutation job
    And the quality job runs unless the workflow was cancelled

  @CRF-14 @CRF-15 @CRF-16 @CRF-17 @NFR-10
  Scenario: The nightly ratchet receives the agent's report when there is one
    When the contributor reads the nightly workflow
    Then the quality job downloads the agent's reports into the mutation reports directory before the ratchet
    And the download is skipped when the agent mutation job was skipped
    And the download action is pinned by its full commit
    And a failed download does not fail the quality job

  @CRF-18 @CRF-19 @CRF-20 @CRF-21
  Scenario: A phase review reads the evidence instead of re-validating the proofs
    When the contributor reads the phase runner instructions
    Then the review reads the phase status and the retry budget of each feature
    And the review does not run the verification validator
    And a feature still runs the verification validator before its merge
    And the review produces the agent's mutation reports before the phase ratchet

  @CRF-22 @CRF-23
  Scenario: The agent mutation command is documented where contributors look
    When the contributor reads the review template and the agent guide
    Then both name "pnpm test:mutation:agent"

  @CRF-25 @CRF-26 @NFR-10
  Scenario: The agent's mutation run creates its report directory on a clean machine
    When the contributor reads the agent mutation command and the nightly workflow
    Then both create the mutation reports directory before their first mutation run

  @CRF-27 @CRF-28 @NFR-10
  Scenario: The shared sampler vector lives where the agent's mutation run can read it
    When the contributor looks for the shared sampler vector
    Then it is inside the agent's adapters crate
    And no copy of it remains in the telemetry package
    And the agent's test and the telemetry package's test read that same file

  @CRF-24
  Scenario: The contracts do not change
    When the contributor runs "pnpm contracts:check"
    Then the command succeeds
