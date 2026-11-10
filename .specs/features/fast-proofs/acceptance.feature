# Acceptance scenarios for fast-proofs (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is the maintainer reading the runner's guide in the repository.

Feature: The fix loop reruns only the proofs that changed
  A preflight caches each green proof under its command and the feature's changed files, and the official proofs run
  once, when the preflight is green.

  # not-scenario: FPR-01 — what the preflight runs and prints is a script rule; proved by its colocated unit test in a temporary git repository
  # not-scenario: FPR-02 — the cache key is a pure function over the command and the changed files; proved by the same unit test file
  # not-scenario: FPR-03 — a cached proof is skipped; proved by the same unit test file
  # not-scenario: FPR-04 — a changed or failed proof runs again; proved by the same unit test file
  # not-scenario: FPR-05 — the exit code; proved by the same unit test file
  # not-scenario: FPR-06 — a missing cache or a git error runs everything; proved by the same unit test file
  # not-scenario: FPR-08 — proved by the gate `pnpm test:harness` on the feature's head

  @FPR-07 @NFR-11
  Scenario: The runner's guide puts the preflight in the fix loop
    When the maintainer reads ".claude/skills/d2rmm-phase-runner/SKILL.md"
    Then its Verify step runs "proofs-preflight.mjs" through the wrapper as step "fix"
    And it runs "check_proofs.py" as step "proofs" once, when the preflight is green, and again only if that run fails
