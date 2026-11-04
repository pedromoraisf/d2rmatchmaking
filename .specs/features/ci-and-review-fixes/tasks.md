# CI and Review Fixes Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, check_proofs, the Verifier).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only harness files change: no file under `apps/`, `packages/` or `.claude/hooks/`, and nothing under `.claude/skills/tlc-spec-driven/`.
- `.quality-baseline.json`: T3 changes `mutation.agent.core`'s `source.path` and nothing else, with the Edit tool. If the gate refuses that edit, stop and report; do not route around it.
- No test, scenario or sensor is weakened, skipped or focused. `acceptance.feature` does not change.
- Every gate runs through `node scripts/attempt.mjs run --feature ci-and-review-fixes --step T<n> -- "<gate>"`, with nothing outside the quotes.
- `@CRF-*` scenarios read files the later tasks change, so they stay red until T8, whose gate runs them all.

---

**Status**: Approved
**Approved**: 2026-11-04 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, rules 3, 4 and 12), `docs/adr/023-bdd-acceptance.md`, `docs/adr/026-mutation-unit-tests-only.md`, `scripts/test/ci-workflow.test.mjs` and `scripts/test/collect.test.mjs` as samples.

| Code Layer                                                      | Required Test Type          | Coverage Expectation                                                                                   | Location Pattern                                     | Run Command                                                         |
| --------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Harness configuration (turbo, baseline, package.json, workflow) | unit (`node:test`)          | Every criterion of the file, parsed from the real file, with a named test                              | `scripts/test/*.test.mjs`                            | `node --test scripts/test/<file>`                                   |
| Metric collection (`scripts/lib/collect.mjs`, unchanged)        | unit (`node:test`)          | The score at the baseline's path: 0 caught, all caught, a mix; absent, empty and unviable-only reports | `scripts/test/collect.test.mjs`                      | `node --test scripts/test/collect.test.mjs`                         |
| Runner instructions (`SKILL.md`, review template, `AGENTS.md`)  | unit (`node:test`)          | Every criterion, read from the real file; the REVIEW and RUN sections are cut by their headings        | `scripts/test/phase-runner-skill.test.mjs`           | `node --test scripts/test/phase-runner-skill.test.mjs`              |
| Acceptance steps                                                | acceptance (playwright-bdd) | The scenarios as written, black-box, reading the repository's own files and commands                   | `tests/acceptance/steps/harness-foundation.steps.ts` | `pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-` |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                       | Command                                                                                    |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Steps      | After the acceptance steps        | `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen` |
| Quick      | After a harness file and its test | `node --test <the task's test file>`                                                       |
| Agent run  | After the mutation command exists | `pnpm test:mutation:agent` then `pnpm quality:collect`                                     |
| Full       | The last task                     | Remove `apps/web/dist`, then `pnpm exec turbo run test:acceptance -- --grep @CRF-`         |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Acceptance steps

Generation fails for every feature while a step is undefined, so the steps come first.

```
T1
```

### Phase 2: Acceptance and metric fixes

```
T2 → T3 → T4 → T5
```

### Phase 3: Review instructions

```
T6 → T7 → T8
```

---

## Task Breakdown

### T1: Write the acceptance steps of this feature

**What**: Add the steps of `.specs/features/ci-and-review-fixes/acceptance.feature` that do not exist yet.
**Where**: `tests/acceptance/steps/harness-foundation.steps.ts`
**Depends on**: None
**Reuses**: The steps' `harness(scenario)`, `shell`, `quoted` and `tail` helpers; the existing `When the contributor runs "<command>"` and `Then the command succeeds` steps, which CRF-24 reuses
**Requirement**: CRF-01, CRF-03, CRF-04, CRF-06, CRF-07, CRF-09, CRF-10, CRF-11, CRF-12, CRF-13, CRF-14, CRF-15, CRF-16, CRF-17, CRF-18, CRF-19, CRF-20, CRF-21, CRF-22, CRF-23

**Done when**:

- [x] The plan step runs `pnpm exec turbo run test:acceptance --dry=json` and asserts that the `@d2rmm/acceptance#test:acceptance` task lists `@d2rmm/web#build` in its dependencies
- [x] The workflow steps parse `.github/workflows/ci.yml` and `nightly.yml`; the baseline step reads `.quality-baseline.json`; the command steps read `package.json`; the instruction steps read `SKILL.md`, the review template and `AGENTS.md`
- [x] The source-path step derives the expected path from the nightly's `--output` for `d2rmm-agent-core`, plus `mutants.out/outcomes.json`, and never hard-codes the answer alone
- [x] No step pins the metric's value: `pnpm quality:ratchet --update` sets it after the merge
- [x] Steps import nothing from `apps/*` (ADR 023)
- [x] Gate check passes: `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen`

**Tests**: acceptance
**Gate**: `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen`
**Commit**: `test(acceptance): add the ci-and-review-fixes steps`

---

### T2: Make the acceptance run build the site

**What**: `test:acceptance` in `turbo.json` also depends on `@d2rmm/web#build`, with a test that pins it and that CI still goes through the command.
**Where**: `turbo.json`
**Depends on**: None (Phase 1 runs first)
**Reuses**: The parsing style of `scripts/test/ci-workflow.test.mjs`, where the new tests go
**Requirement**: CRF-01, CRF-03

**Done when**:

- [ ] `test:acceptance`'s `dependsOn` is `["^build", "@d2rmm/web#build"]`; `cache` and `outputs` are unchanged
- [ ] Test `the acceptance task depends on the site build` reads `turbo.json` and asserts both entries
- [ ] Test `the integration job runs acceptance through the command` asserts the step `pnpm run test:acceptance`
- [ ] Gate check passes, with every earlier test in the file still passing

**Tests**: unit
**Gate**: `node --test scripts/test/ci-workflow.test.mjs`
**Commit**: `fix(harness): build the site before the acceptance run`

---

### T3: Point the agent core metric at the file cargo-mutants writes

**What**: Change `mutation.agent.core`'s `source.path` to `reports/mutation/agent-core/mutants.out/outcomes.json`, with tests through `collect`.
**Where**: `.quality-baseline.json`
**Depends on**: T2
**Reuses**: `collect` and `cargoMutantsScore` in `scripts/lib/collect.mjs`, unchanged; the outcomes shape in `scripts/test/collect.test.mjs`, where the new tests go
**Requirement**: CRF-04, CRF-05, CRF-06, CRF-07, CRF-08

**Done when**:

- [ ] Only `source.path` of `mutation.agent.core` changes; `value`, `direction`, `floor`, `tolerance`, `contexts` and every other metric stay as they are
- [ ] Test `the agent core source is inside the nightly's report directory` takes the nightly's `--output` for `d2rmm-agent-core` and asserts the baseline's path is `<output>/mutants.out/outcomes.json`
- [ ] Test `the agent core metric keeps its rule` asserts direction `higher`, floor 70, tolerance 0.02, contexts `nightly` and `phase`
- [ ] Test `agent core score at the baseline path` calls `collect` with the real baseline and a temporary root, with fixtures for 0 caught and 1 missed (0), all caught (100), and 3 caught, 1 missed and 2 unviable (75)
- [ ] Test `agent core metric stays unset without a score` covers an absent file, an empty outcomes list and an unviable-only list
- [ ] Gate check passes

**Tests**: unit
**Gate**: `node --test scripts/test/collect.test.mjs scripts/test/ratchet.test.mjs`
**Commit**: `fix(harness): read the agent core mutation report where cargo-mutants writes it`

---

### T4: Add the agent mutation command

**What**: Add the root script `test:mutation:agent` with the nightly's three commands, and run it for real.
**Where**: `package.json`
**Depends on**: T3
**Reuses**: The commands in `.github/workflows/nightly.yml`, and `scripts/test/agent-mutation-scope.test.mjs`, where the new tests go
**Requirement**: CRF-09, CRF-10, CRF-11

**Done when**:

- [ ] The script chains, with `&&`, `cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package <crate> --output reports/mutation/agent-<name> -- --lib` for `d2rmm-agent-domain`, `d2rmm-agent-core` and `d2rmm-agent-adapters`
- [ ] Test `the agent mutation command covers the three crates` reads `package.json`
- [ ] Test `each agent mutation command uses unit tests only` asserts every command ends with `-- --lib`
- [ ] Test `each agent mutation command writes where the nightly writes` compares each `--output` with the nightly's, crate by crate
- [ ] Gate check passes and its output shows a number on the line `mutation.agent.core =`

**Tests**: unit
**Gate**: `node --test scripts/test/agent-mutation-scope.test.mjs && pnpm test:mutation:agent && pnpm quality:collect`
**Commit**: `feat(harness): add one command for the agent mutation reports`

---

### T5: Give the nightly ratchet the agent's report

**What**: The `quality` job waits for `agent-mutation`, runs unless cancelled, and downloads the agent's reports before the ratchet.
**Where**: `.github/workflows/nightly.yml`
**Depends on**: T4
**Reuses**: The parsing style of `scripts/test/ci-workflow.test.mjs`, in a new `scripts/test/nightly-workflow.test.mjs`
**Requirement**: CRF-12, CRF-13, CRF-14, CRF-15, CRF-16, CRF-17

**Done when**:

- [ ] `quality` has `needs: agent-mutation` and `if: ${{ !cancelled() }}`
- [ ] A step named `Download the agent's mutation reports`, placed before `Quality ratchet (nightly)`, uses `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4`, with `name: agent-mutation`, `path: reports/mutation`, `if: needs.agent-mutation.result != 'skipped'` and `continue-on-error: true`
- [ ] `agent-mutation` and `backup` are unchanged
- [ ] One named test per criterion: `quality waits for the agent mutation job`, `quality runs unless cancelled`, `the agent reports are downloaded before the ratchet`, `the download is skipped with the agent job`, `the download action is pinned by its full commit`, `a failed download does not fail quality`
- [ ] Gate check passes

**Tests**: unit
**Gate**: `node --test scripts/test/nightly-workflow.test.mjs scripts/test/agent-mutation-scope.test.mjs`
**Commit**: `fix(harness): give the nightly ratchet the agent mutation report`

---

### T6: Make the review read the evidence

**What**: REVIEW step 1 drops `validate_verification.py`, reads `pnpm phase:status` and `node scripts/attempt.mjs status --feature <f>`, and produces the agent's reports before the phase ratchet.
**Where**: `.claude/skills/d2rmm-phase-runner/SKILL.md`
**Depends on**: None (Phase 2 runs first)
**Reuses**: A new `scripts/test/phase-runner-skill.test.mjs`, which cuts the sections by their headings
**Requirement**: CRF-18, CRF-19, CRF-20, CRF-21

**Done when**:

- [ ] REVIEW step 1 reads: `pnpm check`; `pnpm phase:status`; for each feature `node scripts/attempt.mjs status --feature <f>`; `pnpm harness:json`; `pnpm test:mutation:agent`; `pnpm quality:collect`; `pnpm quality:ratchet --context phase`; `node scripts/attempt.mjs report`
- [ ] The step says why in one sentence: the verification gate ran at each feature's head before its merge, and it requires the proofs at HEAD, so it does not run on the phase branch. The sentence does not name the script (CRF-18)
- [ ] The RUN section's Verify step is unchanged
- [ ] One named test per criterion: `the review does not run the verification validator`, `the review reads the phase status and each feature's budget`, `the verify step still runs the validator`, `the review produces the agent reports before the phase ratchet`
- [ ] Gate check passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs`
**Commit**: `fix(harness): read the evidence in the phase review instead of re-validating`

---

### T7: Name the command in the review template

**What**: The template's mutation row names `pnpm test:mutation:agent` beside `pnpm test:mutation`.
**Where**: `.claude/skills/d2rmm-phase-runner/references/templates/review.md`
**Depends on**: T6
**Reuses**: `scripts/test/phase-runner-skill.test.mjs`
**Requirement**: CRF-22

**Done when**:

- [ ] The row `mutation api domain / application / agent core` names both commands
- [ ] Test `the review template names the agent mutation command` reads the row
- [ ] Gate check passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs`
**Commit**: `docs(harness): name the agent mutation command in the review template`

---

### T8: Name the command in AGENTS.md and run the scenarios

**What**: The commands table names `pnpm test:mutation:agent`; the gate proves the whole feature from a checkout with no site build.
**Where**: `AGENTS.md`
**Depends on**: T7
**Reuses**: `scripts/test/phase-runner-skill.test.mjs`
**Requirement**: CRF-02, CRF-23, CRF-24

**Done when**:

- [ ] The row `Mutation (Stryker / cargo-mutants)` names both commands
- [ ] Test `the agent guide names the agent mutation command` reads the row
- [ ] Gate check passes: every `@CRF-*` scenario passes after `apps/web/dist` is removed, and the output has no `the site is not built`

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs && rm -rf apps/web/dist && pnpm exec turbo run test:acceptance -- --grep @CRF-`
**Commit**: `docs(harness): name the agent mutation command in the agent guide`

---

## Checks

**C1** - `pnpm test:acceptance` runs `@d2rmm/web#build` before the acceptance task (CRF-01, AC 1)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-01`

**C2** - The acceptance task depends on `^build` and on `@d2rmm/web#build` in `turbo.json` (CRF-01, AC 1)
Proof: `node --test "--test-name-pattern=the acceptance task depends on the site build" scripts/test/ci-workflow.test.mjs`

**C3** - With no `apps/web/dist`, the acceptance run does not stop with `the site is not built` (CRF-02, AC 2)
Proof: `rm -rf apps/web/dist && pnpm exec turbo run test:acceptance -- --grep @CRF-24`

**C4** - The CI `integration` job runs `pnpm run test:acceptance` (CRF-03, AC 3)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-03`

**C5** - The CI step is pinned by a unit test (CRF-03, AC 3)
Proof: `node --test "--test-name-pattern=the integration job runs acceptance through the command" scripts/test/ci-workflow.test.mjs`

**C6** - The metric's source is `reports/mutation/agent-core/mutants.out/outcomes.json`, and the nightly's `--output` holds it (CRF-04, AC 1; CRF-07, AC 4)
Proof: `node --test "--test-name-pattern=the agent core source is inside the nightly's report directory" scripts/test/collect.test.mjs`

**C7** - The scenario reads the same path from the repository (CRF-04, AC 1; CRF-06, AC 3; CRF-07, AC 4)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-04`

**C8** - `collect` returns 0, 100 and 75 at the baseline's path for 0 of 1, all, and 3 of 4 with 2 unviable (CRF-05, AC 2)
Proof: `node --test "--test-name-pattern=agent core score at the baseline path" scripts/test/collect.test.mjs`

**C9** - The metric keeps direction `higher`, floor 70, tolerance 0.02, and contexts `nightly` and `phase` (CRF-06, AC 3)
Proof: `node --test "--test-name-pattern=the agent core metric keeps its rule" scripts/test/collect.test.mjs`

**C10** - An absent, an empty and an unviable-only report leave the metric unset (CRF-08, AC 5)
Proof: `node --test "--test-name-pattern=agent core metric stays unset without a score" scripts/test/collect.test.mjs`

**C11** - `test:mutation:agent` runs the domain, the core and the adapters (CRF-09, AC 1)
Proof: `node --test "--test-name-pattern=the agent mutation command covers the three crates" scripts/test/agent-mutation-scope.test.mjs`

**C12** - Each command ends with `-- --lib` (CRF-10, AC 2)
Proof: `node --test "--test-name-pattern=each agent mutation command uses unit tests only" scripts/test/agent-mutation-scope.test.mjs`

**C13** - Each `--output` equals the nightly's for that crate (CRF-11, AC 3)
Proof: `node --test "--test-name-pattern=each agent mutation command writes where the nightly writes" scripts/test/agent-mutation-scope.test.mjs`

**C14** - The scenario reads the three crates, the unit-test flag and the paths (CRF-09, CRF-10, CRF-11)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-09`

**C15** - `quality` needs `agent-mutation` (CRF-12, AC 1)
Proof: `node --test "--test-name-pattern=quality waits for the agent mutation job" scripts/test/nightly-workflow.test.mjs`

**C16** - `quality` runs with `!cancelled()` (CRF-13, AC 2)
Proof: `node --test "--test-name-pattern=quality runs unless cancelled" scripts/test/nightly-workflow.test.mjs`

**C17** - The artifact `agent-mutation` is downloaded into `reports/mutation` before `Quality ratchet (nightly)` (CRF-14, AC 3)
Proof: `node --test "--test-name-pattern=the agent reports are downloaded before the ratchet" scripts/test/nightly-workflow.test.mjs`

**C18** - The download has `if: needs.agent-mutation.result != 'skipped'` (CRF-15, AC 4)
Proof: `node --test "--test-name-pattern=the download is skipped with the agent job" scripts/test/nightly-workflow.test.mjs`

**C19** - The action is `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` (CRF-16, AC 5)
Proof: `node --test "--test-name-pattern=the download action is pinned by its full commit" scripts/test/nightly-workflow.test.mjs`

**C20** - The download has `continue-on-error: true` (CRF-17, AC 6)
Proof: `node --test "--test-name-pattern=a failed download does not fail quality" scripts/test/nightly-workflow.test.mjs`

**C21** - The scenarios read the same rules from the workflow (CRF-12 to CRF-17)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-14`

**C22** - The scenario reads `needs` and the job's `if` (CRF-12, AC 1; CRF-13, AC 2)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-12`

**C23** - The REVIEW section does not name `validate_verification.py` (CRF-18, AC 1)
Proof: `node --test "--test-name-pattern=the review does not run the verification validator" scripts/test/phase-runner-skill.test.mjs`

**C24** - The REVIEW section names `pnpm phase:status` and `node scripts/attempt.mjs status --feature` (CRF-19, AC 2)
Proof: `node --test "--test-name-pattern=the review reads the phase status and each feature's budget" scripts/test/phase-runner-skill.test.mjs`

**C25** - The RUN section's Verify step names `validate_verification.py` (CRF-20, AC 3)
Proof: `node --test "--test-name-pattern=the verify step still runs the validator" scripts/test/phase-runner-skill.test.mjs`

**C26** - `pnpm test:mutation:agent` comes before `pnpm quality:ratchet --context phase` in REVIEW (CRF-21, AC 4)
Proof: `node --test "--test-name-pattern=the review produces the agent reports before the phase ratchet" scripts/test/phase-runner-skill.test.mjs`

**C27** - The scenario reads the same rules from `SKILL.md` (CRF-18 to CRF-21)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-18`

**C28** - The review template names the command (CRF-22, AC 5)
Proof: `node --test "--test-name-pattern=the review template names the agent mutation command" scripts/test/phase-runner-skill.test.mjs`

**C29** - `AGENTS.md` names the command (CRF-23, AC 6)
Proof: `node --test "--test-name-pattern=the agent guide names the agent mutation command" scripts/test/phase-runner-skill.test.mjs`

**C30** - The scenario reads both files (CRF-22, CRF-23)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-22`

**C31** - `pnpm contracts:check` reports no drift (CRF-24, AC 1)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-24`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** `execute-batch-1` (T1 to T8) to `feature-worker`
**Walked:** none - no screen; the scenarios read the repository's files

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1
Phase 2:  T2 → T3 → T4 → T5
Phase 3:  T6 → T7 → T8
```

Execution is strictly sequential. Under ADR 025, one `feature-worker` runs all eight tasks as `execute-batch-1`.
