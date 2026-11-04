# CI and Review Fixes Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, check_proofs, the Verifier).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only harness files change, with one exception: T10 moves the test vector and changes the two test paths that read it (AD-131). No other file under `apps/` or `packages/`, no file under `.claude/hooks/`, and nothing under `.claude/skills/tlc-spec-driven/`.
- `.quality-baseline.json`: T3 changes `mutation.agent.core`'s `source.path` and nothing else, with the Edit tool. If the gate refuses that edit, stop and report; do not route around it.
- No test, scenario or sensor is weakened, skipped or focused. `acceptance.feature` does not change during Execute.
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
T2 → T3 → T9 → T11 → T12 → T13 → T10 → T4 → T5
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

- [x] `test:acceptance`'s `dependsOn` is `["^build", "@d2rmm/web#build"]`; `cache` and `outputs` are unchanged
- [x] Test `the acceptance task depends on the site build` reads `turbo.json` and asserts both entries
- [x] Test `the integration job runs acceptance through the command` asserts the step `pnpm run test:acceptance`
- [x] Gate check passes, with every earlier test in the file still passing

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

- [x] Only `source.path` of `mutation.agent.core` changes; `value`, `direction`, `floor`, `tolerance`, `contexts` and every other metric stay as they are
- [x] Test `the agent core source is inside the nightly's report directory` takes the nightly's `--output` for `d2rmm-agent-core` and asserts the baseline's path is `<output>/mutants.out/outcomes.json`
- [x] Test `the agent core metric keeps its rule` asserts direction `higher`, floor 70, tolerance 0.02, contexts `nightly` and `phase`
- [x] Test `agent core score at the baseline path` calls `collect` with the real baseline and a temporary root, with fixtures for 0 caught and 1 missed (0), all caught (100), and 3 caught, 1 missed and 2 unviable (75)
- [x] Test `agent core metric stays unset without a score` covers an absent file, an empty outcomes list and an unviable-only list
- [x] Gate check passes

**Tests**: unit
**Gate**: `node --test scripts/test/collect.test.mjs scripts/test/ratchet.test.mjs`
**Commit**: `fix(harness): read the agent core mutation report where cargo-mutants writes it`

---

### T9: Write the steps of the amended scenarios

**What**: Add the steps of the two scenarios tagged `@CRF-25 @CRF-26` and `@CRF-27 @CRF-28`.
**Where**: `tests/acceptance/steps/harness-foundation.steps.ts`
**Depends on**: T3
**Reuses**: The steps T1 added and their way of reading `package.json` and `nightly.yml`
**Requirement**: CRF-25, CRF-26, CRF-27, CRF-28

**Done when**:

- [x] The directory step asserts, in the script and in the `agent-mutation` job, that a command creating `reports/mutation` comes before the first `cargo mutants`
- [x] The vector steps assert that the file exists under `apps/agent/src-tauri/adapters/test-vectors/`, that `packages/telemetry/test-vectors/sampler.json` does not exist, and that the Rust test and `packages/telemetry/src/sdk/sampler.test.ts` both name the new location
- [x] Gate check passes: `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen`

**Tests**: acceptance
**Gate**: `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen`
**Commit**: `test(acceptance): add the steps of the mutation run scenarios`

---

### T11: Pin the queue's emptiness

**What**: A unit test that a queue holding an item is not empty.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/queue.rs`
**Depends on**: T9
**Reuses**: The file's existing test module
**Requirement**: CRF-29

**Done when**:

- [ ] Test `is_empty_is_false_once_a_span_is_queued` asserts `is_empty()` is true for a new queue and false after a push (kills `BoundedQueue::is_empty -> true`, `queue.rs:51`)
- [ ] No production line changes
- [ ] Gate check passes

**Tests**: unit
**Gate**: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 'test(telemetry::queue)'`
**Commit**: `test(agent): pin the telemetry queue's emptiness`

---

### T12: Pin the relay client's waits and its Debug output

**What**: Unit tests for the two one-hour constants, the probe's next time, and the client's `Debug` text.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/relay_client.rs`
**Depends on**: T11
**Reuses**: The file's existing test module and its `ExportState` helpers
**Requirement**: CRF-29

**Done when**:

- [ ] Test `the_longest_retry_wait_is_one_hour` asserts `MAX_RETRY_AFTER` is 3600 s (kills `*` to `+`, `relay_client.rs:20`)
- [ ] Test `a_refused_token_is_probed_once_an_hour` asserts `PROBE_INTERVAL` is 3600 s (kills `*` to `+`, `relay_client.rs:22`)
- [ ] Test `the_next_probe_comes_one_interval_later` asserts that after a probe, `admit` holds just before `now + PROBE_INTERVAL` and sends at it (kills `+` to `-`, `relay_client.rs:93`)
- [ ] Test `debug_output_names_the_client_and_nothing_else` asserts the text is exactly `RelayHttpClient`, so no header or token can reach a log (kills the `fmt` mutant, `relay_client.rs:148`)
- [ ] No production line changes
- [ ] Gate check passes

**Tests**: unit
**Gate**: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 'test(telemetry::relay_client)'`
**Commit**: `test(agent): pin the relay client's waits and its Debug output`

---

### T13: Pin the sanitizer's dropped count and resource keys

**What**: Unit tests that a sanitized span reports no dropped attributes and that only the four allowed resource keys pass.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/sanitize.rs`
**Depends on**: T12
**Reuses**: The file's existing test module and its span fixture
**Requirement**: CRF-29

**Done when**:

- [ ] Test `a_sanitized_span_reports_no_dropped_attributes` starts from a span with a non-zero `dropped_attributes_count` and asserts 0 (kills the deleted field, `sanitize.rs:49`)
- [ ] Test `only_the_allowed_resource_keys_pass` asserts true for each of `ALLOWED_RESOURCE_KEYS` and false for a key outside them, such as `host.name` (kills `sanitize_resource_key -> true`, `sanitize.rs:59`)
- [ ] No production line changes
- [ ] Gate check passes

**Tests**: unit
**Gate**: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 'test(telemetry::sanitize)'`
**Commit**: `test(agent): pin the sanitizer's dropped count and resource keys`

---

### T10: Move the shared sampler vector into the adapters crate

**What**: `git mv` the vector to `apps/agent/src-tauri/adapters/test-vectors/sampler.json`, and change the two paths that read it and the comment in `sampler.ts`.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/mod.rs`
**Depends on**: T13
**Reuses**: The existing tests `sampler_decisions_match_the_shared_vector` and the shared-vector test of `packages/telemetry/src/sdk/sampler.test.ts`, with their assertions untouched; `scripts/test/agent-mutation-scope.test.mjs`, where the new test goes
**Requirement**: CRF-27, CRF-28, CRF-29

**Done when**:

- [ ] `SAMPLER_VECTOR` in the `#[cfg(test)]` module reads `concat!(env!("CARGO_MANIFEST_DIR"), "/test-vectors/sampler.json")`, and no non-test code changes
- [ ] `sampler.test.ts` reads the new path through `new URL(...)`; the comment in `sampler.ts` names it; no assertion changes
- [ ] The vector's content is unchanged (`git mv`), and `packages/telemetry/test-vectors/` no longer exists
- [ ] Test `the shared sampler vector lives in the adapters crate` asserts the file exists in the crate and is gone from the telemetry package
- [ ] Gate check passes. It runs cargo-mutants on the adapters for real. If it reports a missed mutant, do not change the test or the scope: report the mutants, because the orchestrator decides

**Tests**: unit
**Gate**: `node --test scripts/test/agent-mutation-scope.test.mjs && pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts && mkdir -p reports/mutation && cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-agent-adapters --output reports/mutation/agent-adapters -- --lib`
**Commit**: `fix(agent): keep the shared sampler vector inside the adapters crate`

---

### T4: Add the agent mutation command

**What**: Add the root script `test:mutation:agent`: it creates `reports/mutation`, then runs the nightly's three commands, and it is run for real.
**Where**: `package.json`
**Depends on**: T10
**Reuses**: The commands in `.github/workflows/nightly.yml`, and `scripts/test/agent-mutation-scope.test.mjs`, where the new tests go
**Requirement**: CRF-09, CRF-10, CRF-11, CRF-26

**Done when**:

- [ ] Test `the agent mutation command creates the reports directory first` asserts `mkdir -p reports/mutation` comes before the first `cargo mutants`

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
- [ ] `agent-mutation` gains one step before its first `cargo mutants`: `run: mkdir -p reports/mutation` with `shell: bash`, because the job's default shell on Windows is PowerShell. Nothing else in that job changes, and `backup` is unchanged
- [ ] Test `the agent job creates the reports directory first` asserts that order (CRF-25)
- [ ] Test `the agent job uploads its reports even when a command fails` pins the upload's existing `if: always()`, which is how a missed mutant's score reaches the ratchet (AD-130)
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

**C32** - The `agent-mutation` job creates `reports/mutation` before its first `cargo mutants` (CRF-25, AC 1)
Proof: `node --test "--test-name-pattern=the agent job creates the reports directory first" scripts/test/nightly-workflow.test.mjs`

**C33** - `test:mutation:agent` creates `reports/mutation` before its first `cargo mutants` (CRF-26, AC 2)
Proof: `node --test "--test-name-pattern=the agent mutation command creates the reports directory first" scripts/test/agent-mutation-scope.test.mjs`

**C34** - The scenario reads both orders (CRF-25, CRF-26)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-25`

**C35** - The vector lives in the adapters crate and is gone from the telemetry package (CRF-27, AC 3)
Proof: `node --test "--test-name-pattern=the shared sampler vector lives in the adapters crate" scripts/test/agent-mutation-scope.test.mjs`

**C36** - The adapters' unit test reads the vector inside the crate and its decisions match (CRF-27, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 'test(sampler_decisions_match_the_shared_vector)'`

**C37** - The TypeScript sampler test reads the same file and its decisions match (CRF-28, AC 4)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts`

**C38** - The scenario reads the location from the repository (CRF-27, CRF-28)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CRF-27`

**C39** - The agent job's upload keeps `if: always()`, so a missed mutant's score reaches the ratchet (AD-130)
Proof: `node --test "--test-name-pattern=the agent job uploads its reports even when a command fails" scripts/test/nightly-workflow.test.mjs`

**C40** - cargo-mutants reports no missed mutant on the adapters with `-- --lib` (CRF-29, AC 5)
Proof: `mkdir -p reports/mutation && cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-agent-adapters --output reports/mutation/agent-adapters -- --lib`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** `execute-batch-1` (T1 to T8) to `feature-worker`, returned at T4; `execute-batch-2` (T9, T10, T4 to T8) to `feature-worker`, returned at T10; `execute-batch-3` (T11, T12, T13, T10, T4 to T8) to `feature-worker`
**Walked:** none - no screen; the scenarios read the repository's files
**Blocked:** `gate:ci-and-review-fixes/T4` (2 of 3 failures; the third would block it). The task as written cannot pass. Last error: `cargo test failed in an unmutated tree` for `d2rmm-agent-adapters`: `telemetry::tests::sampler_decisions_match_the_shared_vector` panics `the shared sampler vector: NotFound`. The test reads `CARGO_MANIFEST_DIR/../../../../packages/telemetry/test-vectors/sampler.json`, and cargo-mutants copies only `apps/agent/src-tauri` into its tree, so the file is outside the copy (exit 4). Attempt 1 failed because cargo-mutants does not create the `reports/mutation` parent of `--output` on a fresh checkout; attempt 2 added `mkdir -p reports/mutation &&` as the first segment of the script, and then ran domain (82 mutants: 62 caught, 20 unviable) and core (89 mutants: 59 caught, 30 unviable) with no missed mutant, before the adapters baseline failed. `pnpm quality:collect` on the written report gives `mutation.agent.core = 100`. Nothing committed for T4; `package.json` and `scripts/test/agent-mutation-scope.test.mjs` are uncommitted in the worktree. A fix needs a maintainer decision: move the vector into the crate, or let cargo-mutants see `packages/`; a skip or a weaker assertion is out of bounds. T5 (not started) also needs a replan: its `agent-mutation` job has the same missing-directory and adapters-baseline problems on a fresh runner, and its upload step has no `if: always()`, so a non-zero cargo-mutants exit (a missed mutant) skips the upload and the score never reaches the ratchet, which spec assumption AD-130 requires. T5 says `agent-mutation` unchanged, so the orchestrator must replan it. T6 to T8 not started.
**Replanned (orchestrator, 2026-11-04):** the unit is not blocked: it stands at 2 of 3 with its last attempt kept for T4. Correction to the note above: the agent job's upload step does have `if: always()` (`nightly.yml`), so a missed mutant's score does reach the artifact; T5 now pins it. The vector moves into the adapters crate (AD-131, CRF-25 to CRF-28), through new tasks T9 and T10, which run before T4 so T10's gate proves the adapters' baseline without spending T4's last attempt. The uncommitted T4 work stays in the worktree.
**Replanned again (orchestrator, 2026-11-04):** T10's gate failed once (1 of 3): the adapters' baseline passes, and cargo-mutants reports 114 mutants: 80 caught, 7 missed, 27 unviable. T11, T12 and T13 kill the 7 with unit tests (AD-132, CRF-29) before T10's gate runs again. The uncommitted T10 and T4 work stays in the worktree.

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1
Phase 2:  T2 → T3 → T9 → T11 → T12 → T13 → T10 → T4 → T5
Phase 3:  T6 → T7 → T8
```

Execution is strictly sequential. Under ADR 025, `feature-worker` runs the tasks: `execute-batch-1` stopped at T4, and `execute-batch-2` stopped at T10, and `execute-batch-3` runs T11, T12, T13, T10, T4 and the rest.
