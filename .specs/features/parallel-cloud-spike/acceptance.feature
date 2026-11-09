# Acceptance scenarios for parallel-cloud-spike (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is the maintainer reading the spike's two documents in the repository.

Feature: The gates are measured in a cloud session
  A cloud session runs the project's gates on the spike's branch, the same gates are timed on the phase machine, and a
  note and a Proposed ADR carry the numbers.

  # not-scenario: PCS-05 — the session's conduct; proved by the prompt recorded in the note (scenario below) and the feature's diff, read by the Verifier
  # not-scenario: PCS-06 — proved by the gate `pnpm test:harness` on the feature's head and the feature's diff

  @PCS-01 @PCS-02 @PCS-03 @NFR-11
  Scenario: The note gives every gate a cloud and a local result
    When the maintainer reads "docs/engineering/cloud-sessions.md"
    Then every gate of the spike has a row with its command, a cloud status, exit code and seconds, and local seconds, or the reason it did not run
    And the note names the date, the session's CPU count and memory, whether Docker and a browser were available, and the local load average at start
    And the note holds the prompt the cloud session was given, which forbids edits, commits, pushes, secrets and the production database

  @PCS-04 @NFR-11
  Scenario: The ADR is proposed and stands on the note
    When the maintainer reads "docs/adr/029-parallel-cloud-sessions.md"
    Then its status is "Proposed"
    And it has a Decision section
    And it cites "docs/engineering/cloud-sessions.md" and at least one measured gate time
    And it names a whole feature run and concurrency as unmeasured
