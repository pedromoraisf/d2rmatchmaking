# CI and Review Fixes Specification

**Approved**: 2026-11-04 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

**Amended by the runner** (assumed, AD-131; to confirm at the phase review): 2026-11-04, Execute found that the agent's mutation commands fail on a fresh runner and in the adapters' baseline, so the nightly's commands could not run as written. CRF-25 to CRF-28 are appended and no approved criterion is edited. They move one test vector into the adapters crate and change two test paths. This is the one exception to "harness files only" in Out of Scope; no product behaviour changes.

**Amended again by the runner** (assumed, AD-132; to confirm at the phase review): 2026-11-04, once the adapters' baseline passed, cargo-mutants reported 7 missed mutants of 114 that no run had ever shown. CRF-29 is appended. It adds unit tests in the adapters' telemetry modules and no production change. `dispatch:ci-and-review-fixes/review-spec` has used its three dispatches, so CRF-29 has no fresh `spec-reviewer` verdict.

## Problem Statement

The F0 review found three harness defects. The CI `integration` job runs the acceptance suite with no site build, so its first run should fail with `the site is not built`. The quality baseline reads `reports/mutation/agent-core/outcomes.json` while cargo-mutants writes `reports/mutation/agent-core/mutants.out/outcomes.json`, and the nightly ratchet job never receives the report, so the agent's mutation score is never compared. The review step runs `validate_verification.py` on the phase branch, where it cannot pass after a merge and spends retry budget each time. These must be fixed before `phase/F0` is pushed. Source: `.specs/phases/F0/brief-revision-3.md`, approved by the maintainer on 2026-11-04.

## Goals

- [ ] A checkout with no `apps/web/dist` runs `pnpm test:acceptance` without a separate build step, locally and in CI.
- [ ] `pnpm quality:collect` prints a number for `mutation.agent.core` after the agent's mutation run, locally and in the nightly.
- [ ] `/phase-review` spends no retry budget on a check that cannot pass on the phase branch.

## Out of Scope

| Feature                                                                                      | Reason                                                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Any product behaviour: API, site, agent or contract changes                                  | The feature changes harness files and one test vector with its two test paths (CRF-24, AD-131) |
| Editing `validate_verification.py` or anything in `.claude/skills/tlc-spec-driven/`          | Vendored (AGENTS.md, "Never do")                                                               |
| Setting `mutation.agent.core`'s value, floor, tolerance or contexts                          | The first value comes from `pnpm quality:ratchet --context phase --update`, after the merge    |
| `test:e2e` having no task in any workspace                                                   | Risk 5 of `review.md`, out by brief revision 3                                                 |
| The API domain mutation margin                                                               | Risk 6 of `review.md`, out by brief revision 3                                                 |
| The nightly's `Harness report` failure on `main`, the `backup` reviewer and its waiting runs | Risk 7 of `review.md`, out by brief revision 3                                                 |
| Telemetry and egress reduction                                                               | Risk 8 of `review.md`, out by brief revision 3                                                 |
| Building the headless example in a fresh local checkout, and the rejection at `world.ts:259` | Risk 9 of `review.md`, out by brief revision 3                                                 |
| Whether read-only steps should spend retry budget                                            | Risk 10 of `review.md`, out by brief revision 3                                                |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision                                  | Chosen default                                                                                                                                                            | Rationale                                                                                                                                                                                                | Confirmed?           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| How acceptance gets the site                           | `test:acceptance` in `turbo.json` also depends on `@d2rmm/web#build`                                                                                                      | One line; it fixes CI and a fresh local checkout together; no workspace dependency or lockfile change                                                                                                    | y - brief revision 3 |
| What the nightly does when `agent-mutation` is skipped | `quality` still runs and skips the download. `detect` sets `agent=true` whenever `apps/agent/src-tauri/Cargo.toml` exists, so the job runs every night in practice        | Revision 3 left this to this feature. The ratchet fails a measured metric that goes missing, which is the correct signal if the crate were ever removed                                                  | n - AD-130, assumed  |
| What the nightly does when `agent-mutation` fails      | `quality` still runs and tries the download; a download with no artifact does not fail the job                                                                            | A score must reach the ratchet when cargo-mutants exits non-zero on a missed mutant. With no report, the ratchet itself decides: "not measured yet", or "a sensor stopped reporting" once a value exists | n - AD-130, assumed  |
| Which crates `test:mutation:agent` covers              | Core, domain and adapters, with the nightly's `--output` paths                                                                                                            | The same report layout everywhere, so the review and the nightly read the same paths                                                                                                                     | y - brief revision 3 |
| What replaces the validator in the review step         | `pnpm phase:status` and `node scripts/attempt.mjs status --feature <f>`                                                                                                   | `validate_verification.py` still runs in RUN step 6 at the feature's head before the merge; the maintainer approved this in revision 3                                                                   | y - brief revision 3 |
| Which action SHA the download step pins                | `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`, the commit tag `v4` resolved to on 2026-11-04 (`gh api repos/actions/download-artifact/commits/v4`) | The same major as the workflow's `upload-artifact@v4`; a new action in a job that reads an artifact is pinned, as `ci.yml`'s `integration` job pins what it adds                                         | n - stated here      |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Acceptance builds the site it serves ⭐ MVP

**User Story**: As a contributor or the CI job, I want the acceptance run to build the site itself so that a fresh checkout does not fail every scenario.

**Why P1**: without it, the first CI run on `phase/F0` is expected to fail and exit criteria 1, 9 and 11 stay unproven.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. CRF-01: WHEN `pnpm test:acceptance` runs THEN the system SHALL run `@d2rmm/web#build` before `@d2rmm/acceptance#test:acceptance`
2. CRF-02: IF `apps/web/dist` does not exist THEN `pnpm test:acceptance` SHALL NOT stop with `the site is not built`
3. CRF-03: The CI `integration` job SHALL run acceptance through `pnpm run test:acceptance`, so CRF-01 applies to it

**Independent Test**: remove `apps/web/dist`, run one scenario through `pnpm test:acceptance`, and see it pass.

---

### P1: The agent's mutation score is collected ⭐ MVP

**User Story**: As the maintainer, I want the ratchet to read the agent's real mutation score so that exit criterion 15 holds and a drop in the score fails a run.

**Why P1**: the metric reads "not measured" even with the report on disk, so the ratchet guards nothing for the agent.

**Acceptance Criteria**:

1. CRF-04: The baseline's source path for `mutation.agent.core` SHALL be `reports/mutation/agent-core/mutants.out/outcomes.json`
2. CRF-05: WHEN that file holds cargo-mutants outcomes THEN `collect` SHALL return `mutation.agent.core` as caught / (caught + missed) in percent
3. CRF-06: The baseline's direction, floor, tolerance and contexts for `mutation.agent.core` SHALL stay as they are on `phase/F0`
4. CRF-07: The nightly's `--output` for `d2rmm-agent-core` SHALL be the directory that holds `mutants.out` in that source path
5. CRF-08: IF the outcomes file is absent, or holds only unviable mutants, or no mutants, THEN `collect` SHALL leave `mutation.agent.core` unset

**Independent Test**: write an outcomes fixture at the source path in a temporary root, call `collect`, and read the number.

---

### P1: One command produces the agent's mutation reports ⭐ MVP

**User Story**: As the runner of a phase review, I want one command for the agent's mutation reports so that the phase ratchet has a value to compare.

**Why P1**: `pnpm test:mutation` covers only the API.

**Acceptance Criteria**:

1. CRF-09: WHEN `pnpm test:mutation:agent` runs THEN the system SHALL run cargo-mutants on `d2rmm-agent-domain`, `d2rmm-agent-core` and `d2rmm-agent-adapters`
2. CRF-10: Each cargo-mutants command in `test:mutation:agent` SHALL end with `-- --lib` (ADR 026)
3. CRF-11: Each cargo-mutants command in `test:mutation:agent` SHALL use the `--output` path the nightly uses for that crate

**Independent Test**: read the script in `package.json` and compare each command with the nightly's.

---

### P1: The nightly ratchet receives the agent's report ⭐ MVP

**User Story**: As the maintainer, I want the nightly ratchet to see the agent's score so that a drop fails the nightly.

**Why P1**: `agent-mutation` runs on Windows in its own job, and `quality` runs the ratchet on Linux, so the report never reaches it.

**Acceptance Criteria**:

1. CRF-12: The nightly `quality` job SHALL start only after `agent-mutation` has finished
2. CRF-13: IF `agent-mutation` fails or is skipped THEN the `quality` job SHALL still run, unless the workflow was cancelled
3. CRF-14: WHEN `agent-mutation` was not skipped THEN `quality` SHALL download the `agent-mutation` artifact into `reports/mutation` before the step `Quality ratchet (nightly)`
4. CRF-15: IF `agent-mutation` was skipped THEN `quality` SHALL skip the download step
5. CRF-16: The download action SHALL be pinned by the full commit SHA named in the assumptions above
6. CRF-17: IF the `agent-mutation` artifact does not exist THEN the failed download SHALL NOT fail the `quality` job, so the ratchet step still runs and gives its own verdict

**Independent Test**: parse `nightly.yml` and read the job's `needs`, `if` and step order.

---

### P1: The review reads evidence instead of re-validating ⭐ MVP

**User Story**: As the maintainer, I want the phase review to stop running a validator that cannot pass on the phase branch so that a review never blocks a finished feature.

**Why P1**: the F0 review blocked `gate:agent-hexagonal-migration/verification` this way.

**Acceptance Criteria**:

1. CRF-18: The REVIEW section of `.claude/skills/d2rmm-phase-runner/SKILL.md` SHALL NOT name `validate_verification.py`
2. CRF-19: The REVIEW section SHALL name `pnpm phase:status` and `node scripts/attempt.mjs status --feature`
3. CRF-20: The RUN section's Verify step SHALL name `validate_verification.py`
4. CRF-21: The REVIEW section SHALL name `pnpm test:mutation:agent` before `pnpm quality:ratchet --context phase`
5. CRF-22: The review template's row for the agent's mutation SHALL name `pnpm test:mutation:agent`
6. CRF-23: The commands table in `AGENTS.md` SHALL name `pnpm test:mutation:agent`

**Independent Test**: read the three files and compare.

---

### P1: No contract changes

**User Story**: As the maintainer, I want these harness fixes to leave the contracts alone so that the F0 review's API numbers still hold.

**Why P1**: the brief's revision 3 excludes product behaviour.

**Acceptance Criteria**:

1. CRF-24: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)

**Independent Test**: run `pnpm contracts:check`.

---

### P1: The agent's mutation commands run from a fresh checkout ⭐ MVP

**User Story**: As the nightly or a contributor, I want the agent's mutation commands to work on a clean machine so that the reports this feature reads actually exist.

**Why P1**: cargo-mutants does not create the parent of `--output`, and it copies only `apps/agent/src-tauri`, where `telemetry::tests::sampler_decisions_match_the_shared_vector` cannot find the vector in `packages/telemetry/test-vectors/`. Both stop the run before any adapters mutant.

**Acceptance Criteria**:

1. CRF-25: The nightly `agent-mutation` job SHALL create `reports/mutation` before its first cargo-mutants command
2. CRF-26: `pnpm test:mutation:agent` SHALL create `reports/mutation` before its first cargo-mutants command
3. CRF-27: The shared sampler vector SHALL live in `apps/agent/src-tauri/adapters/test-vectors/sampler.json`, and the adapters' unit test SHALL read it from there
4. CRF-28: The TypeScript sampler test SHALL read that same file, so the parity between the senders (AD-102) stays proved by one vector
5. CRF-29: WHEN cargo-mutants runs on `d2rmm-agent-adapters` with `-- --lib` THEN the system SHALL report no missed mutant, with no test weakened and no scope narrowed

**Independent Test**: run cargo-mutants on `d2rmm-agent-adapters` with `-- --lib` and see the unmutated baseline pass; run the TypeScript sampler test.

---

## Edge Cases

- CRF-08 covers the absent and the empty outcomes file.
- CRF-17 covers a job that fails before its upload step.
- CRF-15 covers a skipped agent job.

---

## Requirement Traceability

| Requirement ID | Story                                         | Phase | Status  |
| -------------- | --------------------------------------------- | ----- | ------- |
| CRF-01         | P1: Acceptance builds the site it serves      | Tasks | Pending |
| CRF-02         | P1: Acceptance builds the site it serves      | Tasks | Pending |
| CRF-03         | P1: Acceptance builds the site it serves      | Tasks | Pending |
| CRF-04         | P1: The agent's mutation score is collected   | Tasks | Pending |
| CRF-05         | P1: The agent's mutation score is collected   | Tasks | Pending |
| CRF-06         | P1: The agent's mutation score is collected   | Tasks | Pending |
| CRF-07         | P1: The agent's mutation score is collected   | Tasks | Pending |
| CRF-08         | P1: The agent's mutation score is collected   | Tasks | Pending |
| CRF-09         | P1: One command produces the mutation reports | Tasks | Pending |
| CRF-10         | P1: One command produces the mutation reports | Tasks | Pending |
| CRF-11         | P1: One command produces the mutation reports | Tasks | Pending |
| CRF-12         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-13         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-14         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-15         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-16         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-17         | P1: The nightly ratchet receives the report   | Tasks | Pending |
| CRF-18         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-19         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-20         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-21         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-22         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-23         | P1: The review reads evidence                 | Tasks | Pending |
| CRF-24         | P1: No contract changes                       | Tasks | Pending |
| CRF-25         | P1: Mutation commands from a fresh checkout   | Tasks | Pending |
| CRF-26         | P1: Mutation commands from a fresh checkout   | Tasks | Pending |
| CRF-27         | P1: Mutation commands from a fresh checkout   | Tasks | Pending |
| CRF-28         | P1: Mutation commands from a fresh checkout   | Tasks | Pending |
| CRF-29         | P1: Mutation commands from a fresh checkout   | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 29 total, 29 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-3.md` - the three fixes, approved by the maintainer ("aprovo a revisão 3 do brief da F0"). It says to "list" the command "in the review step"; CRF-22 and CRF-23 extend that to the review template and to `AGENTS.md`, whose commands table is the canonical list
- `.specs/phases/F0/review.md` - risks 1, 3 and 4, and the out-of-scope risks
- `docs/product/prd.md#NFR-10` - mutation testing on domain and application (CRF-04 to CRF-17, CRF-25 to CRF-28)
- AD-102 and AD-131 in `.specs/STATE.md` - the shared vector comes from the Rust rule, and where it lives (CRF-27, CRF-28)
- `docs/product/prd.md#NFR-11` - harness verified in CI (CRF-01 to CRF-03; the review's numbers depend on it)
- ADR 020 - contract drift (CRF-24)
- ADR 021 - the phase review flow (CRF-18 to CRF-23)
- ADR 023 - acceptance scenarios (CRF-01 to CRF-03)
- ADR 026 - mutation against unit tests only (CRF-09 to CRF-11)

---

## Success Criteria

Local proofs cover every criterion above: scenarios and unit tests read the files, and a gate exercises CRF-02. Three things are only seen later, and are not requirements of this feature's gates:

- [ ] The CI `integration` job passes acceptance on a GitHub run, after the maintainer's push.
- [ ] A nightly on GitHub shows a number for `mutation.agent.core`. Run `41653012528` failed its `quality` job at `Harness report`, before the ratchet step, and that failure is out of scope here, so this may stay unseen until it is fixed.
- [ ] `/phase-review F0` runs with no new failure on any `verification` unit.
