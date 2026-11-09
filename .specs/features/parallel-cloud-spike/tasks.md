# Parallel Cloud Spike Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only `docs/engineering/cloud-sessions.md`, `docs/adr/029-parallel-cloud-sessions.md`, `tests/acceptance/steps/parallel-cloud-spike.steps.ts` and `.specs/` change. No runner, gate, hook, product or contract change.
- The cloud measurement is the orchestrator's step before T1 (it starts the cloud session; workers cannot); its results, the prompt and the session id are written in `## Handoff` and are the input of T1.
- The local baseline runs with no other suite running; record the 1-minute load average before the first command.
- Every gate runs through `node scripts/attempt.mjs run --feature parallel-cloud-spike --step T<n> -- "<gate>"`, launched with this worktree as the working directory, with nothing outside the quotes.

---

**Design**: none - Small feature
**Status**: Approved
**Approved**: 2026-11-09 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 0
**Build**: `pnpm lint; pnpm typecheck; pnpm test:harness`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (How to test), ADR 023.

| Code Layer           | Required Test Type          | Coverage Expectation                   | Location Pattern                                       | Run Command                                           |
| -------------------- | --------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| The note and the ADR | acceptance (playwright-bdd) | Every scenario of `acceptance.feature` | `tests/acceptance/steps/parallel-cloud-spike.steps.ts` | `pnpm exec turbo run test:acceptance -- --grep @PCS-` |

## Gate Check Commands

| Gate Level | When to Use         | Command                                                   |
| ---------- | ------------------- | --------------------------------------------------------- |
| Full       | Each task           | `pnpm exec turbo run test:acceptance -- --grep @PCS-0<n>` |
| Build      | After the last task | `pnpm lint; pnpm typecheck; pnpm test:harness`            |

---

## Execution Plan

### Phase 1: The note and the ADR

```
T1 → T2
```

---

## Task Breakdown

### T1: The measured note

**What**: Time each gate of AD-173 on the phase machine (record the 1-minute load average first; it must be below 2), then write `docs/engineering/cloud-sessions.md`: a table with one row per gate (command, cloud status, cloud exit code, cloud seconds, local seconds, blocker), the date, the cloud session's CPU count and memory, whether Docker and a browser were available there, the local load average at start, and the exact prompt the cloud session was given — all cloud values copied from `## Handoff`. Add the steps of the scenario "The note gives every gate a cloud and a local result" to `tests/acceptance/steps/parallel-cloud-spike.steps.ts` (black box: they read the file).
**Where**: `docs/engineering/cloud-sessions.md`, `tests/acceptance/steps/parallel-cloud-spike.steps.ts`
**Depends on**: None
**Reuses**: the step style of `tests/acceptance/steps/ci-fast-path.steps.ts` (repository files read as a contributor)
**Requirement**: PCS-01, PCS-02, PCS-03, PCS-05

**Done when**:

- [ ] Every gate of AD-173 has a row; a gate that did not run in the cloud names its blocker
- [ ] The scenario "The note gives every gate a cloud and a local result" passes
- [ ] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @PCS-03`

**Commit**: `docs(harness): measure the gates in a cloud session`

---

### T2: The Proposed ADR

**What**: `docs/adr/029-parallel-cloud-sessions.md`, in the format of the existing ADRs, status `Proposed`: Context (the 8 GB machine, the note's numbers), a Decision section that decides whether and how the runner sends independent features to parallel cloud sessions, citing `docs/engineering/cloud-sessions.md` and at least one measured gate time, and Consequences naming as unmeasured a whole feature run (dispatch, worktrees, the ledger, hooks during edits) and concurrency. Add the steps of "The ADR is proposed and stands on the note".
**Where**: `docs/adr/029-parallel-cloud-sessions.md`, `tests/acceptance/steps/parallel-cloud-spike.steps.ts`
**Depends on**: T1
**Reuses**: `docs/adr/028-autonomous-delivery.md` (format)
**Requirement**: PCS-04, PCS-06

**Done when**:

- [ ] The ADR is `Proposed`, has a Decision section, cites the note and a measured time, and names the unmeasured items
- [ ] Every scenario of `acceptance.feature` passes; `pnpm test:harness` passes with no test removed or skipped
- [ ] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @PCS- && pnpm test:harness`

**Commit**: `docs(adr): propose parallel cloud sessions for independent features`

---

## Checks

**C1** - The note gives every gate a cloud and a local result, the environment and the prompt (PCS-01, PCS-02, PCS-03, PCS-05)
Proof: `pnpm exec turbo run test:acceptance -- --grep @PCS-03`

**C2** - The ADR is Proposed, decides, cites the numbers and names what is unmeasured (PCS-04)
Proof: `pnpm exec turbo run test:acceptance -- --grep @PCS-04`

**C3** - The harness suite passes with nothing removed or skipped (PCS-06)
Proof: `pnpm test:harness`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** none
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 → T2
```

Batches: `execute-batch-1` runs phase 1 (T1, T2), after the orchestrator's cloud measurement.
