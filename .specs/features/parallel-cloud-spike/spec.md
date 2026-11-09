# Parallel Cloud Spike Specification

**Approved**: 2026-11-09 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

F0's features ran one machine's worth at a time: an 8 GB laptop shared by the orchestrator, parallel workers, Docker,
Playwright and cargo, and three workers at once already slowed the gate benchmark threefold. Claude Code can run a
session in the cloud on a branch. Before the runner sends independent features to parallel cloud sessions, this spike
measures whether the project's gates run there at all and how long each takes against the phase machine. Source:
`.specs/phases/F0/brief-revision-6.md` § 3 (parallel-cloud-spike), approved by the maintainer on 2026-11-07; the cloud
session's cost approved by the maintainer on 2026-11-09 ("Pode sim").

## Goals

- [ ] A measured answer, per gate, to "does it run in a cloud session, and how long against this machine".
- [ ] A Proposed ADR the maintainer can accept or reject, on running independent features in parallel cloud sessions.

## Out of Scope

| Feature                                                                                    | Reason                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Any change to the runner, the gate, the hooks or the retry budget                          | Brief revision 6: "No change to the runner in this revision"                             |
| Running a whole feature (dispatch, worktrees, the ledger, hooks during edits) in the cloud | AD-173: the spike runs the gates of an existing feature; the ADR lists these as unproven |
| Several sessions at once (concurrency, shared limits, quotas)                              | AD-173: one session; the ADR names concurrency as unmeasured                             |
| Accepting the ADR                                                                          | The maintainer's (AGENTS.md rule 8)                                                      |
| Changing cloud environments, network allowlists or secrets                                 | The maintainer's (ADR 028 § 1); the spike uses what the session has                      |
| Any product behaviour                                                                      | The row writes two documents and their test                                              |

---

## Assumptions & Open Questions

| Assumption / decision              | Chosen default                                                                                                                                                                                                                                                                                                           | Rationale                                                                                                              | Confirmed?          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------- |
| What "run one small feature" means | Run the gates of `ci-fast-path` (a small, merged feature) in the cloud: `pnpm install`, `pnpm check`, `pnpm test:integration`, its acceptance scenarios (`--grep @CFP-`), the agent's `cargo nextest run`, and the pre-commit hooks (`pnpm exec lefthook run pre-commit --all-files`, no commit); not a full feature run | The gates are what a parallel session must be able to run; a full run needs dispatch and the ledger the cloud may lack | n - AD-173, assumed |
| Which session runs them            | One Claude Code cloud session on `feat/F0-parallel-cloud-spike` (which holds `ci-fast-path`), in this session's environment, that measures only: no file edit, no commit, no push                                                                                                                                        | The smallest spend that answers the question; the maintainer approved the cost                                         | y - "Pode sim"      |
| The local baseline                 | The same commands on the phase machine, the same grep, started with the 1-minute load average below 2 and no other suite running                                                                                                                                                                                         | The gate benchmark showed load triples timings                                                                         | n - AD-173, assumed |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Measure the gates in a cloud session ⭐ MVP

**User Story**: As the maintainer, I want each gate measured in a cloud session and on this machine so that I can decide whether features may run in parallel in the cloud.

**Why P1**: the brief's only deliverable for this row.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. PCS-01: WHEN the spike runs THEN one cloud session SHALL run each gate of AD-173 on `feat/F0-parallel-cloud-spike` and report, per gate, the command, whether it ran, its exit code, its wall time and, when it did not run, the error that stopped it
2. PCS-02: WHEN the cloud results exist THEN the same gates SHALL be timed on the phase machine, starting with the 1-minute load average below 2 and no other suite running
3. PCS-03: `docs/engineering/cloud-sessions.md` SHALL hold, per gate, the command, the cloud status, exit code and seconds, the local seconds and the blocker if any; the date; the session's CPU count and memory; whether Docker and a browser were available; the local load average at start; and the prompt the cloud session was given
4. PCS-04: `docs/adr/029-parallel-cloud-sessions.md` SHALL be an ADR with status `Proposed` and a Decision section that decides whether and how the runner sends independent features to parallel cloud sessions, citing the note and at least one measured gate time, and naming as unmeasured what the spike did not run (a whole feature run, concurrency)

**Independent Test**: read the note's table and the ADR.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want the spike to measure and write, not to change the harness or reach anything that is mine.

**Why P1**: brief revision 6 and ADR 028 § 1.

**Acceptance Criteria**:

1. PCS-05: The cloud session's prompt SHALL forbid file edits, commits, pushes, repository secrets and the production database, and the session SHALL NOT make any of them
2. PCS-06: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped, and the feature's diff SHALL touch only the two documents, their acceptance steps and `.specs/`

**Independent Test**: read the prompt in the note and the feature's diff.

---

## Edge Cases

- PCS-01 covers a gate that cannot run in the cloud (no Docker, no browser, a blocked host): it is reported with its error, not skipped.
- PCS-03 covers a gate measured only locally: its cloud cell says why.
- PCS-04 covers a "do not run in parallel" decision: the ADR may decide against, and still cites the numbers.

---

## Requirement Traceability

| Requirement ID | Story                                    | Phase | Status  |
| -------------- | ---------------------------------------- | ----- | ------- |
| PCS-01         | P1: Measure the gates in a cloud session | Tasks | Pending |
| PCS-02         | P1: Measure the gates in a cloud session | Tasks | Pending |
| PCS-03         | P1: Measure the gates in a cloud session | Tasks | Pending |
| PCS-04         | P1: Measure the gates in a cloud session | Tasks | Pending |
| PCS-05         | P1: Nothing else changes                 | Tasks | Pending |
| PCS-06         | P1: Nothing else changes                 | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 6 total, 6 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 3 (parallel-cloud-spike), approved by the maintainer ("Aprovo a revisão do ADR 028.") (PCS-01 to PCS-04)
- ADR 021 and ADR 025 - the phase runner and its roles (PCS-04)
- ADR 028 § 1 - what stays the maintainer's (PCS-05)
- `docs/product/prd.md#NFR-11` - harness verified in CI (PCS-06)

---

## Success Criteria

- [ ] The maintainer can accept or reject ADR 029 from the note's numbers alone.
