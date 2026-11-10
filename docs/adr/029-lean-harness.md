# ADR 029 — Lean harness: CI is the gate, the hooks only guard what cannot be undone

**Status**: Accepted
**Date**: 2026-11-10 (accepted 2026-11-10 by the maintainer: "Liberar o enxugamento: Aceito")
**Deciders**: maintainer
**Supersedes**: ADR 019 (harness level 4 as a CI gate), ADR 021 (per-feature delegation ceremony), ADR 022 (retry
budget enforced by code), ADR 024 (phase state from trailers and the ledger), and ADR 028 § 3 and § 4 (`harness-self`,
the merge guard and the verdict hook; budget resets). ADR 028 § 1 and § 2 (delivery is the runner's) stand. ADR 025
stands; its gate enforcement is removed.

## Context

At the end of F0 the harness held about 14,000 lines of code and 15,000 lines of tests, against 38,000 lines of
product with no business feature yet. Since brief revision 6 (2026-11-07), 233 commits went to `main`: 112 `specs`,
88 `harness`, about 8 of product. Each friction fix added more harness, and each new piece became a new way to stop:

- `verdict.mjs` never recorded a security verdict in this environment, so the maintainer merged PRs 32 to 34 by hand.
- The merge guard's 2 s git reads timed out under load, the gate denied `git fetch` three times, and the session's
  retry budget ran out until the maintainer reset it (2026-11-10).
- The rows that moved fastest were the ones run in "fast mode", with the Verifier and mutation switched off.
- Ceremony outweighed code: 6 brief revisions, a 1,590-line `STATE.md` with 175 assumed decisions, per-task commit
  trailers, per-feature approval lines quoting the kickoff, spec and tasks reviewers, a Verifier and `proofs.md`.

The maintainer asked for a cycle that does not depend on them, even if that means removing parts of TLC and of the
harness (2026-11-10).

## Decision

1. **CI is the quality gate.** Format, lint, types, dependency-cruiser, unit, contract, integration, acceptance and the
   PR ratchet run on every PR (`ci.yml`). A feature PR merges when the required checks are green.
2. **Mutation testing runs only in the nightly** (`nightly.yml`), never on a PR or in a task. The phase review reads the
   nightly report. ADR 026 (unit tests only) stands.
3. **The gate (`.claude/hooks/gate.mjs`) is small and stateless.** It denies force pushes, remote deletions, `.env`
   files, the production database, skipped hooks, recursive removal of the root or home, edits to vendored TLC and to
   committed migrations. It asks for secrets, variables, repository settings and edits to sensors and their thresholds.
   It has no ledger, no read-only table, no polling rule, no merge guard and no network call.
4. **No retry budget in code.** `attempt.mjs`, the ledger and the verdict hook are removed. The rule stays as text:
   after three failures of the same thing, stop, record the blocker in the phase's `decisions.md` and a lesson in
   `docs/engineering/lessons.md`, and move on.
5. **Lessons are a short hand-written file**, `docs/engineering/lessons.md`, that every agent reads at the start. TLC's
   `lessons.py` (candidates that need two features before anyone reads them) is no longer used.
6. **Per feature**: `spec.md` (EARS requirements traced to the PRD) and `acceptance.feature` (ADR 023); `design.md` only
   for Large or Complex features; `tasks.md` as a checklist (`- [ ] T<n> …`). No approval line per feature: the phase
   brief's approval covers the specs inside its scope. No spec reviewer, no Verifier, no `proofs.md`, no commit trailers.
   The architecture reviewer, and the security reviewer when the feature touches auth, the agent, secrets or the network
   edge, comment once on the PR's diff.
7. **Phase state** comes from the brief, each feature's files and which feature branches merged into the phase branch
   (`scripts/phase-status.mjs`).
8. **Human stops**: the brief's approval and the phase review's approval, plus the escalations of AGENTS.md (secrets,
   production database, repository settings, money).
9. **The harness score is a report, not a gate.** `pnpm harness` still prints it; CI no longer requires level 4, and the
   harness metrics leave `.quality-baseline.json`. PRD NFR-11 changes accordingly.

## Alternatives considered

- **Fix the failing pieces one by one** (verdict recording, guard timeouts, worker directories). It is what revision 6
  did; it grew the harness and each fix brought its own failure modes.
- **Keep the retry budget but stop counting environment failures.** Budget-v2 tried it; the session still ran out on
  timeouts it classified as denials.
- **Remove the gate entirely.** The few irreversible actions (force push, deletions, secrets, production data) are
  cheap to guard and expensive to undo.

## Consequences

- Easier: an agent can run a phase without the maintainer between the brief and the review; a failing check costs one
  fix, not a ledger reset; the harness suite runs in under a second.
- Harder: nothing in code stops an agent from retrying a failing step many times. The text rule and the lessons file
  must hold that line; if they do not, measure it and decide again.
- The removed features of F0 (`harness-bootstrap`, `budget-v2`, `gate-precision`, `fast-proofs`, `continuous-delivery`)
  move to `.specs/archive/`.
- Hypothesis H-001, to revisit after F1's first features: if Haiku workers still need many fix rounds on the lean
  harness, try Sonnet workers (ADR 025).
- Revisit at the F1 review: time from brief to review, maintainer interventions, fix rounds per feature.
