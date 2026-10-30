# ADR 023 — BDD acceptance tests: Gherkin in the spec, executed by playwright-bdd

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Each feature card of a phase (TLC `spec.md`) states its acceptance criteria in EARS. Agents translate them into
tests, and that translation is where intent leaks: a test can pass while proving something slightly different. The
maintainer wants the acceptance scenarios written in Gherkin on the card itself and that exact text running as the
highest-level tests, with the most native tooling possible.

## Decision

- Every feature with requirement IDs has `.specs/features/<feature>/acceptance.feature`, in **English** Gherkin.
  Each scenario is tagged with the requirement ID(s) it proves (`@ROOM-01`), optionally with `@FR-xx`, `@INV-xx`
  and a routing tag (`@web`, `@api`, `@agent`). A requirement proved another way (e.g. a load test) carries a
  `# not-scenario: <ID> — <how>` line, which the maintainer confirms.
- **playwright-bdd** runs those files directly through Playwright Test (already our e2e runner): one runner for
  browser journeys (`page`) and API/agent-contract scenarios (`request`). Steps live in `tests/acceptance/steps`, one
  file per bounded context, and are black-box (no imports from `apps/*`). `missingSteps: 'fail-on-gen'`,
  `retries: 0`, `forbidOnly: true`.
- `scripts/acceptance-check.mjs` (zero dependencies) runs in the spec gate, on edit and in CI: every requirement
  covered, only known tags, no `@skip/@only/@fixme/@wip`, English keywords, each scenario with a `When` and a `Then`,
  outlines with examples.
- The scenarios are the TLC proofs: `## Checks` proof for a criterion =
  `bddgen && playwright test --grep @<REQ-ID>` (via `scripts/attempt.mjs`, ADR 022).
- The gate hook treats `.feature` files like tests: `@only` and non-English denied; skipping, removing scenarios or
  adding a not-scenario exemption ask the maintainer. The Playwright config is a protected harness file.

## Alternatives considered

- Cucumber.js — a second test stack (runner, World, reporters) beside Vitest and Playwright.
- QuickPickle (Vitest plugin) — the most native for API-level tests, but a small project (maintenance risk) and
  browser support via a separate package.
- cucumber-rs for the agent — the agent's acceptance goes through its public HTTP contract instead; OCR stays in Rust
  unit tests with image fixtures.
- Copying scenarios into test files — drift between the card and the test is exactly what this ADR removes.

## Consequences

- The approved card is the executable specification; the phase review shows scenario results per requirement.
- Acceptance runs need the stack up (local `main/local.ts` or the PR preview) and are slower; they run in the CI
  integration job and in proofs, not in pre-commit.
- `bddgen` adds a generation step; generated files (`.features-gen/`) are ignored by git.
