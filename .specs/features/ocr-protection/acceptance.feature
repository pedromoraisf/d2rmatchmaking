# Acceptance scenarios for ocr-protection (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is a contributor at a clean checkout; steps read the repository's files and run the
# harness checks on a temporary copy.
# not-scenario: OCP-02 — proved by a harness test with a negative fixture (a listed module outside the mutation scope)
# not-scenario: OCP-03 — proved by the agent-mutation-scope and agent-source-rules harness tests
# not-scenario: OCP-04 — proved by `cargo test -p d2rmm-agent-core --lib` passing in one process
# not-scenario: OCP-05 — proved by the nightly dispatched on the branch (no unexplained survivor) and equal ocr-variations counts
# not-scenario: OCP-07 — a rule of the phase runner's skill; proved by review of its text
# not-scenario: OCP-08 — proved by the gate-rules unit tests

Feature: The OCR reading logic cannot be rewritten to please a mutation score
  The maintainer's reading logic was tuned on real prints. A contributor sees the rule before touching it, and an
  exclusion without evidence never passes.

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @OCP-01 @NFR-03
  Scenario: The rule is where every agent reads first
    When the contributor reads AGENTS.md and the feature worker's instructions
    Then both say that a survivor in a reading module is killed only by a test that pins the current behaviour
    And both name the list of reading modules

  @OCP-06 @NFR-03
  Scenario: A mutation exclusion without evidence fails the harness
    Given a copy of the mutation config with an exclusion that has no evidence comment
    When the contributor runs the mutation config check on that copy
    Then the check fails and names the exclusion
