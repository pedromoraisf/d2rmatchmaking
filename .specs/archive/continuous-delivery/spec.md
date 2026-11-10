# Continuous Delivery Specification

**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

In F0 CI first saw the code on day 6, and the last mile from "every feature verified" to `main` took 58.7 hours for
6.5 hours of work: feature branches merged locally into `phase/F0`, nothing was pushed until the phase review, and the
maintainer pushed and opened the phase PR by hand. ADR 028 makes delivery the runner's. This row teaches the runner to
deliver through pull requests from the first feature: it pushes the phase branch at kickoff with a draft PR to `main`,
pushes each feature with a PR into the phase branch, merges on green checks, merges the phase PR when the review's gates
pass, and records what still needs the maintainer without stopping the rest of the phase. Source:
`.specs/phases/F0/brief-revision-6.md` § 3 (continuous-delivery), approved by the maintainer on 2026-11-07; ADR 028.

## Goals

- [ ] CI runs on every feature, through a PR the runner opened, before the feature reaches the phase branch.
- [ ] A phase closes when its review's gates are green and its PR is merged into `main`, with no push or merge left to
      the maintainer.
- [ ] An item that needs the maintainer blocks only the feature that needs it.

## Out of Scope

| Feature                                                            | Reason                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| The gate's delivery rules (which push, PR and merge commands pass) | `harness-bootstrap`, merged (ADR 028 § 1)                      |
| Required checks and the ruleset                                    | `ci-fast-path`, merged; applying a ruleset is the maintainer's |
| Caching proofs between runs                                        | `fast-proofs`, brief revision 6                                |
| Running features in parallel cloud sessions                        | `parallel-cloud-spike`, brief revision 6                       |
| Any product behaviour: API, site, agent or contract changes        | The row changes the phase runner, its state and templates      |

The existing `phase-state` and `phase-status` tests that expect the `awaiting-review` step change with CDL-07 (AD-168):
a spec-driven change of expected behaviour, recorded here, not a weakened test.

---

## Assumptions & Open Questions

| Assumption / decision                                         | Chosen default                                                                                                                                                                                                                                      | Rationale                                                                                                          | Confirmed?           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| How the review stops gating the merge                         | `phase-status` drops `awaiting-review`: a phase with `review.md` goes to `merge`, then `closed` once `phase/F<n>` is merged into `main`; an approval line in the review is no longer read                                                           | ADR 028 § 1: the runner merges the phase PR when the review's gates are green; the maintainer reads it afterwards  | n - AD-168, assumed  |
| Where "what still needs the maintainer" lives                 | A `## For the maintainer` table in `decisions.md` (Feature, Item, Asked, Answer); a row whose Answer is empty or blank blocks its feature; `phase-status` prints each open row on its feature's line on every run, never suppressed after the first | One place the maintainer reads; evidence `phase-status` can derive (ADR 024)                                       | n - AD-169, assumed  |
| Which checks gate the phase PR when no ruleset is applied yet | The runner treats `verify`, `integration`, `agent` and `secrets` (the checks ADR 028 § 2 names) as required: each must have run on the phase PR's head and passed, whatever the ruleset says                                                        | Applying the ruleset is the maintainer's; the runner must not merge into `main` on fewer checks than ADR 028 names | n - AD-170, assumed  |
| Which acceptance scenarios run locally at integration         | The feature's own, selected by its requirement-ID prefix (`--grep @<PREFIX>-`); the full suite, load and full mutation run in CI only                                                                                                               | The brief names it; the full suite does not fit the 8 GB machine                                                   | y - brief revision 6 |

**Open questions:** none - all resolved or logged above.

---

## Definitions

- **Phase PR**: the pull request from `phase/F<n>` to `main`, opened as a draft at kickoff.
- **Feature PR**: the pull request from `feat/F<n>-<feature>` to `phase/F<n>`.
- **Merged into `main`**: `phase/F<n>` is an ancestor of `main` or of `origin/main`.
- **Open maintainer item**: a row of `decisions.md → ## For the maintainer` whose Answer cell is empty or holds only
  spaces.
- **The review's gates**: `review.md` was written by `/phase-review` from its own runs (`pnpm check` on `phase/F<n>`,
  `pnpm quality:ratchet --context phase`, the retry-budget report), and each of those runs passed.

---

## User Stories

### P1: CI runs from the first feature ⭐ MVP

**User Story**: As the maintainer, I want every feature to reach CI through a PR so that a red check shows up the day the feature is built, not at the phase review.

**Why P1**: F0's first CI run came on day 6.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. CDL-01: WHEN `/phase-kickoff F<n>` creates `phase/F<n>` THEN the runner SHALL push it and open a draft phase PR to `main`
2. CDL-02: WHEN a feature's verification gate passes THEN the runner SHALL push `feat/F<n>-<feature>` and open a feature PR into `phase/F<n>`
3. CDL-03: WHEN the runner integrates a feature THEN it SHALL run the local `pnpm check` and the feature's own acceptance scenarios (`--grep @<PREFIX>-`), and wait for the feature PR's required checks to pass
4. CDL-18: WHEN the runner integrates a feature THEN it SHALL NOT run the full acceptance suite, the load test or the full mutation run locally; CI runs them
5. CDL-04: WHEN a feature's integration is green THEN the runner SHALL merge its PR with `gh pr merge --merge`, never squash or rebase, so the progress trailers reach `phase/F<n>`; `phase-status` SHALL read a feature as integrated only when its `Step: verification` commit is reachable from `phase/F<n>`
6. CDL-05: WHEN the runner waits for a PR's checks THEN it SHALL start `gh pr checks <pr> --watch` as a background task and continue on that task's notification

**Independent Test**: read the RUN section of the phase-runner skill and find each step; run `phase-status` on a repository where a feature reached `phase/F<n>` through a merge commit, then through a squash commit without trailers.

---

### P1: The phase closes on green gates ⭐ MVP

**User Story**: As the maintainer, I want the runner to merge the phase into `main` when the review's gates pass so that the last mile takes minutes, and I read the review afterwards.

**Why P1**: F0's last mile took 58.7 hours.

**Acceptance Criteria**:

1. CDL-06: WHEN the review's gates passed and every check of AD-170 passed on the phase PR's head THEN the runner SHALL mark the phase PR ready and merge it with `gh pr merge --merge`; IF any of them did not THEN it SHALL not merge and SHALL record why in `review.md`
2. CDL-07: WHEN `review.md` exists THEN `phase-status` SHALL report the phase step `merge` until `phase/F<n>` is merged into `main`, and `closed` after, whether or not the review holds an approval line (AD-168)
3. CDL-17: WHEN `phase/F<n>` is an ancestor of `origin/main` but not of the local `main` THEN `phase-status` SHALL count it as merged into `main`

**Independent Test**: run `phase-status` on a repository with a review and no approval line, before and after merging the phase branch into `main`, and after merging it only into `origin/main`.

---

### P1: What needs the maintainer blocks only its feature ⭐ MVP

**User Story**: As the maintainer, I want the questions only I can answer collected in one place so that one of them does not stop the whole phase.

**Why P1**: brief revision 6 § 6 and ADR 028 keep secrets, settings, money, ADRs, briefs and weaker tests with the maintainer.

**Acceptance Criteria**:

1. CDL-16: WHEN a feature needs an item ADR 028 § 1 keeps with the maintainer (a secret or variable, a repository setting or ruleset, money, an ADR or brief approval, a weaker test or sensor, a reset beyond the orchestrator's one) THEN the runner SHALL add a row for it to `decisions.md → ## For the maintainer`, leave the gate's permission prompt for that action unanswered, and continue with the features that do not depend on it
2. CDL-08: WHILE a feature has an open maintainer item THEN `phase-status` SHALL report that feature `blocked` with the reason `maintainer`; a feature that depends on it SHALL be `waiting`, and the others SHALL keep their own state (AD-169)
3. CDL-09: WHEN `phase-status` runs THEN it SHALL print each open maintainer item on the line of its feature, and an item whose feature is not in the brief on the phase line (AD-169)
4. CDL-10: WHEN a maintainer item's Answer cell holds text other than spaces THEN `phase-status` SHALL no longer count it

**Independent Test**: add an open row for one feature and read that feature blocked, its dependent waiting and another ready; fill its Answer and read it ready.

---

### P1: Templates and guides tell the remote flow ⭐ MVP

**User Story**: As the runner of the next phase, I want the brief and review templates and the skill to describe the remote flow so that F1 starts with it.

**Why P1**: brief revision 6 § 3 names the template changes.

**Acceptance Criteria**:

1. CDL-11: The brief template SHALL carry a "Delivery" section describing the remote flow (CDL-01 to CDL-06 and CDL-16)
2. CDL-12: The review template SHALL drop the section of commands the maintainer runs to push and open the PR
3. CDL-13: The phase-runner skill and the `/phase-run` and `/phase-review` commands SHALL describe CDL-01 to CDL-10 and CDL-16 to CDL-18, and SHALL no longer contain "leave it ready and list it in the review" nor "the exact commands the maintainer runs to push and open the PR"

**Independent Test**: read the two templates, the skill and the two commands.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want this row to leave the product alone and every test intact.

**Why P1**: brief revision 6 is harness-only.

**Acceptance Criteria**:

1. CDL-14: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped
2. CDL-15: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)

**Independent Test**: run the two commands.

---

## Edge Cases

- CDL-04 covers a feature that reaches `phase/F<n>` through the merge commit of its PR (`done`) and one squashed into a commit with no trailers (not `done`).
- CDL-07 covers a review with an approval line (still `closed` after the merge), one without, and no review at all (step `review`).
- CDL-08 covers a feature waiting on a feature blocked by a maintainer item: it stays `waiting`, as with any blocked dependency.
- CDL-09 covers two open items for one feature (both printed) and an item for a feature not in the brief (printed on the phase line).
- CDL-10 covers an empty Answer cell (the scenario) and one holding only spaces (a unit test of `phase-state`, since Gherkin trims cells): both still open.
- CDL-04's instruction half (`gh pr merge --merge`, never squash or rebase) is proved by `scripts/test/phase-runner-skill.test.mjs`; CDL-13's absent phrases are checked with whitespace normalised, since they wrap in the skill.
- CDL-17 covers a stale local `main` after the phase PR was merged on GitHub and `origin/main` was fetched.

---

## Requirement Traceability

| Requirement ID | Story                                                 | Phase | Status  |
| -------------- | ----------------------------------------------------- | ----- | ------- |
| CDL-01         | P1: CI runs from the first feature                    | Tasks | Pending |
| CDL-02         | P1: CI runs from the first feature                    | Tasks | Pending |
| CDL-03         | P1: CI runs from the first feature                    | Tasks | Pending |
| CDL-04         | P1: CI runs from the first feature                    | Tasks | Pending |
| CDL-05         | P1: CI runs from the first feature                    | Tasks | Pending |
| CDL-06         | P1: The phase closes on green gates                   | Tasks | Pending |
| CDL-07         | P1: The phase closes on green gates                   | Tasks | Pending |
| CDL-08         | P1: What needs the maintainer blocks only its feature | Tasks | Pending |
| CDL-09         | P1: What needs the maintainer blocks only its feature | Tasks | Pending |
| CDL-10         | P1: What needs the maintainer blocks only its feature | Tasks | Pending |
| CDL-11         | P1: Templates and guides tell the remote flow         | Tasks | Pending |
| CDL-12         | P1: Templates and guides tell the remote flow         | Tasks | Pending |
| CDL-13         | P1: Templates and guides tell the remote flow         | Tasks | Pending |
| CDL-14         | P1: Nothing else changes                              | Tasks | Pending |
| CDL-15         | P1: Nothing else changes                              | Tasks | Pending |
| CDL-16         | P1: What needs the maintainer blocks only its feature | Tasks | Pending |
| CDL-17         | P1: The phase closes on green gates                   | Tasks | Pending |
| CDL-18         | P1: CI runs from the first feature                    | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 18 total, 18 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 3 (continuous-delivery) and § 4 - the scope and the exit criteria, approved by the maintainer ("Aprovo a revisão do ADR 028.")
- ADR 028 § 1 - delivery is the runner's; what stays the maintainer's; the review no longer gates the merge (CDL-01, CDL-02, CDL-04, CDL-06 to CDL-10, CDL-16, CDL-17)
- ADR 028 § 2 - required checks are the safety net (CDL-03, CDL-06, CDL-18)
- ADR 024 - phase state derived from evidence (CDL-04, CDL-07 to CDL-10, CDL-17)
- ADR 021 - the phase runner and its templates (CDL-11 to CDL-13)
- ADR 020 - contract drift (CDL-15)
- `docs/product/prd.md#NFR-11` - harness verified in CI (CDL-03, CDL-05, CDL-14, CDL-18)
- `.specs/features/harness-bootstrap/spec.md` - the gate's delivery rules this row relies on

---

## Success Criteria

- [ ] `fast-proofs` and `parallel-cloud-spike` reach `phase/F0` through PRs the runner pushed and merged, with required checks green.
- [ ] F0's phase PR merges into `main` the day its review's gates pass.
