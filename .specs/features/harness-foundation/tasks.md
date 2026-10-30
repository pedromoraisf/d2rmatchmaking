# Harness Foundation Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

This feature is harness work: editing the sensor and harness files named in a task's `Where` is the task itself, under
the phase delegation `harness-edits` (`.specs/phases/F0/brief.md`). Moving a configuration never drops or relaxes a
rule.

---

**Design**: `.specs/features/harness-foundation/design.md`
**Status**: Approved
**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test), `docs/engineering/testing.md`, `docs/adr/014-testing-and-mutation.md`, `.quality-baseline.json` (mutation floors 80/70), `package.json` (`test:harness` = `node --test`), `tests/acceptance/playwright.config.ts`.

| Code Layer                                                            | Required Test Type          | Coverage Expectation                                                                       | Location Pattern                       | Run Command                                       |
| --------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------- |
| API shared kernel (pure)                                              | unit (Vitest) + mutation    | Every exported function and branch; 1:1 to HF-06 AC 1; mutation score ≥ 80%                | `apps/api/src/shared-kernel/*.test.ts` | `pnpm --filter @d2rmm/api test`                   |
| API mutation runner                                                   | unit (Vitest)               | Empty layer, non-empty layer, thresholds per layer, report paths                           | `apps/api/scripts/*.test.ts`           | `pnpm --filter @d2rmm/api test`                   |
| Contracts generator                                                   | unit (Vitest)               | Versions, empty paths/channels, deterministic output                                       | `packages/contracts/src/*.test.ts`     | `pnpm --filter @d2rmm/contracts test`             |
| Config presets                                                        | unit (Vitest)               | Every preset loads; strict flags, purity and enum rules, Prettier options present          | `packages/config/test/*.test.ts`       | `pnpm --filter @d2rmm/config test`                |
| Harness scripts and fixtures                                          | unit (`node:test`)          | Each fixture case names its rule; control case passes; `summarize` counts skipped and todo | `scripts/test/*.test.mjs`              | `pnpm test:harness`                               |
| Acceptance scenarios                                                  | acceptance (playwright-bdd) | Every scenario of `acceptance.feature`, as written                                         | `tests/acceptance/steps/*.steps.ts`    | `pnpm --filter @d2rmm/acceptance test:acceptance` |
| Root configuration files (re-exports of the presets, Vitest projects) | none                        | - (build gate; the T1 deep-equality presets test guards their content)                     | -                                      | build gate                                        |
| Empty workspace skeletons, release config, module folders             | none                        | - (build gate only; acceptance covers them)                                                | -                                      | build gate                                        |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                              | Command                                                                       |
| ---------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Quick      | After tasks with unit tests only         | `pnpm --filter <workspace> test` or `pnpm test:harness`                       |
| Full       | After tasks with acceptance tests        | `pnpm --filter @d2rmm/acceptance test:acceptance`                             |
| Build      | After config-only tasks and at phase end | `pnpm build && pnpm typecheck && pnpm lint && pnpm arch && pnpm format:check` |

---

## Execution Plan

### Phase 1: Presets and workspaces

```
T3 → T1 → T2 → T4 → T5 → T6 → T7
```

### Phase 2: API workspace and mutation

```
T8 → T9 → T10 → T11 → T12
```

### Phase 3: Sensors and release config

```
T13 → T14 → T15
```

### Phase 4: Acceptance and baseline

```
T16 → T17
```

### Phase 5: Verifier findings (round 1)

```
T18 → T19 → T20 → T21 → T22
```

---

## Task Breakdown

#### Phase 1: Presets and workspaces

### T3: Add the root Vitest projects configuration

**What**: Root `vitest.config.ts` with `test.projects: ['apps/*', 'packages/*']` and Vitest as a root devDependency, so Lefthook's `vitest related` and the quality reports run every workspace. It comes first because the pre-commit `unit-related` hook runs root Vitest on every staged `apps/**`/`packages/**` TypeScript file.
**Where**: `vitest.config.ts`
**Depends on**: None
**Reuses**: Lefthook `unit-related` command
**Requirement**: HF-01

**Done when**:

- [x] `pnpm exec vitest run --passWithNoTests` from the root exits 0 (and runs the `@d2rmm/config` tests once that workspace exists)
- [x] Gate check passes: `pnpm install && pnpm exec vitest run --passWithNoTests`

**Tests**: none
**Gate**: quick

---

### T1: Create the `@d2rmm/config` presets workspace

**What**: `packages/config` with `tsconfig.base.json`, `tsconfig.dom.json`, `eslint.mjs`, `prettier.json` moved verbatim from the root files, its `package.json` (exports, ESLint plugin dependencies) and `test/presets.test.ts`.
**Where**: `packages/config/`
**Depends on**: T3
**Reuses**: root `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json` (content moved, no rule changed)
**Requirement**: HF-02

**Done when**:

- [x] `packages/config/package.json` exports `./tsconfig.base.json`, `./tsconfig.dom.json`, `./eslint`, `./prettier`; scripts `build`, `typecheck`, `test` as in design.md
- [x] `tsconfig.base.json` = the old root options plus `rewriteRelativeImportExtensions` and `erasableSyntaxOnly` (both `true`); `eslint.mjs` = the old root array with every rule unchanged and the ignores `.claude/worktrees/**`, `**/.features-gen/**`, `**/.stryker-tmp/**`, `**/.turbo/**` added
- [x] `test/presets.test.ts` asserts deep equality against a literal copy of the expected configuration: full `compilerOptions`, full Prettier options, and every ESLint block written in the repo (all `ignores`, `no-console`, `eqeqeq`, the `TSEnumDeclaration` ban, `no-explicit-any`, `consistent-type-imports`, the domain `no-restricted-globals`/`no-restricted-properties` block with its `files` glob, the scripts/hooks override); plugin blocks asserted present by reference
- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/config test`
- [x] Test count: ≥ 3 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T2: Point the root configuration at the presets

**What**: Root `tsconfig.base.json` extends `@d2rmm/config/tsconfig.base.json`, `eslint.config.mjs` re-exports `@d2rmm/config/eslint`, the root `package.json` gets `"prettier": "@d2rmm/config/prettier"` (and `.prettierrc.json` is removed), and the root `package.json` adds `@d2rmm/config: workspace:*` and drops the ESLint plugin packages now owned by the preset.
**Where**: root `eslint.config.mjs`
**Depends on**: T1
**Reuses**: T1 presets
**Requirement**: HF-02

**Done when**:

- [x] `pnpm lint` exits 0 with 0 warnings and `pnpm format:check` exits 0 (same rules as before the move)
- [x] Gate check passes: `pnpm install && pnpm lint && pnpm format:check && pnpm --filter @d2rmm/config typecheck && pnpm --filter @d2rmm/config test`

**Tests**: none
**Gate**: build

---

### T4: Create the `@d2rmm/web` workspace skeleton

**What**: `apps/web` with `package.json` (scripts `build`, `typecheck`, `lint` = `eslint --max-warnings 0 .`, `test` as in design.md), `tsconfig.json` extending `@d2rmm/config/tsconfig.dom.json`, `tsconfig.build.json`, and `src/index.ts`.
**Where**: `apps/web/`
**Depends on**: T2
**Reuses**: T1 presets
**Requirement**: HF-01

**Done when**:

- [x] `pnpm --filter @d2rmm/web build`, `typecheck`, `lint` and `test` each exit 0
- [x] `pnpm arch` exits 0 with the root `tsconfig.base.json` that extends the preset (moved from T2: depcruise needs `apps/`, which this task creates)
- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web lint && pnpm --filter @d2rmm/web test && pnpm arch`

**Tests**: none
**Gate**: build

---

### T5: Create the `@d2rmm/agent` workspace skeleton

**What**: `apps/agent` (TypeScript UI only, AD-026; `version` `0.0.0`) with the same files and scripts as T4; no `src-tauri/`.
**Where**: `apps/agent/`
**Depends on**: T4
**Reuses**: T4 layout
**Requirement**: HF-01

**Done when**:

- [x] `apps/agent/package.json` has `"version": "0.0.0"`; no `apps/agent/src-tauri` exists
- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/agent build && pnpm --filter @d2rmm/agent typecheck && pnpm --filter @d2rmm/agent lint && pnpm --filter @d2rmm/agent test`

**Tests**: none
**Gate**: build

---

### T6: Create the `@d2rmm/telemetry` workspace skeleton

**What**: `packages/telemetry` with the T4 files and scripts, extending `@d2rmm/config/tsconfig.base.json`, and an `exports` entry for `dist/index.js`.
**Where**: `packages/telemetry/`
**Depends on**: T5
**Reuses**: T4 layout
**Requirement**: HF-01

**Done when**:

- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/telemetry build && pnpm --filter @d2rmm/telemetry typecheck && pnpm --filter @d2rmm/telemetry lint && pnpm --filter @d2rmm/telemetry test`

**Tests**: none
**Gate**: build

---

### T7: Create `@d2rmm/contracts` with the document generator

**What**: `packages/contracts` workspace with `src/documents.ts` (`buildOpenApiDocument`, `buildAsyncApiDocument`), `src/documents.test.ts`, `scripts/generate.ts`, script `contracts:openapi`, and the generated `openapi.json` / `asyncapi.json` committed.
**Where**: `packages/contracts/`
**Depends on**: T6
**Reuses**: T4 layout
**Requirement**: HF-04

**Done when**:

- [x] Tests assert `openapi` = `3.1.0` with `paths` `{}`, `asyncapi` = `3.0.0` with `channels` `{}`, and two calls return deep-equal documents
- [x] `pnpm contracts:check` exits 0 twice in a row with no diff
- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/contracts test && pnpm contracts:check && pnpm format:check`
- [x] Test count: ≥ 3 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

#### Phase 2: API workspace and mutation

### T8: Create the `@d2rmm/api` workspace with five modules × three layers

**What**: `apps/api` workspace (T4 scripts, base preset) and `src/modules/{identity,agents,matchmaking,lobby-room,ranking}/` each with `index.ts` (`export {};`) and `domain/.gitkeep`, `application/.gitkeep`, `adapters/.gitkeep`.
**Where**: `apps/api/`
**Depends on**: T7
**Reuses**: T4 layout
**Requirement**: HF-05

**Done when**:

- [x] The 5 × 3 folders and 5 `index.ts` files exist; no `src/main/`
- [x] `pnpm arch` exits 0
- [x] Gate check passes: `pnpm install && pnpm --filter @d2rmm/api build && pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api lint && pnpm --filter @d2rmm/api test && pnpm arch`

**Tests**: none
**Gate**: build

---

### T9: Implement `Result` in the shared kernel

**What**: `Result<T, E>`, `ok`, `err`, `isOk`, `isErr` with `result.test.ts` and the `shared-kernel/index.ts` barrel.
**Where**: `apps/api/src/shared-kernel/result.ts`
**Depends on**: T8
**Reuses**: none
**Requirement**: HF-06

**Done when**:

- [x] Tests assert the exact value/error carried and both guards on both variants
- [x] Gate check passes: `pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 4 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T10: Implement `Clock` and `FakeClock`

**What**: `Clock` port and `FakeClock` (`now`, `advance`, `set`) with `clock.test.ts`, exported from the barrel.
**Where**: `apps/api/src/shared-kernel/clock.ts`
**Depends on**: T9
**Reuses**: none
**Requirement**: HF-06

**Done when**:

- [x] Tests assert `now()` equals the start, `advance(1500)` moves it by exactly 1500 ms, `set` replaces it, and mutating a returned `Date` does not change the clock
- [x] Gate check passes: `pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 4 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T11: Implement `IdGenerator` and `SequentialIdGenerator`

**What**: `IdGenerator` port and `SequentialIdGenerator` (`id-1`, `id-2`, …; custom prefix) with `id-generator.test.ts`, exported from the barrel.
**Where**: `apps/api/src/shared-kernel/id-generator.ts`
**Depends on**: T10
**Reuses**: none
**Requirement**: HF-06

**Done when**:

- [x] Tests assert the exact sequence for the default and a custom prefix, and that two generators do not share a counter
- [x] Gate check passes: `pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 3 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T12: Wire Stryker per layer with the mutation runner

**What**: `apps/api/stryker.config.mjs`, `scripts/mutation-plan.ts` (`layerConfig`, `planLayer`, `emptyReport`), `scripts/mutation.ts`, `scripts/mutation-plan.test.ts`, script `test:mutation` = `node scripts/mutation.ts`, Stryker dev dependencies, and `"cache": false` for `test:mutation` in `turbo.json`.
**Where**: `apps/api/scripts/mutation-plan.ts`
**Depends on**: T11
**Reuses**: design.md "Mutation runner"
**Requirement**: HF-06, HF-09

**Done when**:

- [x] Tests: `layerConfig('domain').thresholds.break` is 80 and `layerConfig('application').thresholds.break` is 70; report paths are `reports/mutation/api-<layer>/mutation.json` at the repository root; on an empty temporary tree the runner writes an application report with zero mutants and exits 0
- [x] `pnpm --filter @d2rmm/api test:mutation` exits 0 and writes both report files; the domain score is ≥ 80
- [x] Gate check passes: `pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:mutation`
- [x] Test count: ≥ 4 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

#### Phase 3: Sensors and release config

### T13: Add the architecture violation fixtures and their test

**What**: Fixture cases under `scripts/test/fixtures/arch/` (four violations + `clean`) and `scripts/test/arch-fixtures.test.mjs`.
**Where**: `scripts/test/arch-fixtures.test.mjs`
**Depends on**: T12
**Reuses**: `.dependency-cruiser.cjs` unchanged
**Requirement**: HF-03, HF-05

**Done when**:

- [x] Importer layers pinned as in design.md; one test per case, named after its rule (`domain-is-pure`, `application-no-adapters`, `no-cross-module-internals`, `nobody-imports-main`) asserting exit ≠ 0 and that the error-severity rule names equal exactly that rule; the `clean` test asserts exit 0 and no violation
- [x] `pnpm arch` on the real tree still exits 0
- [x] Gate check passes: `pnpm test:harness && pnpm arch && pnpm lint && pnpm format:check`

**Tests**: unit
**Gate**: quick

---

### T14: Produce the quality reports in one script

**What**: `scripts/quality-reports.mjs`, `scripts/lib/tests-summary.mjs`, `scripts/test/quality-reports.test.mjs`, root scripts `quality:reports` and the new `quality:gate` order, and the CI ratchet step calling `pnpm run quality:gate` in place of the separate report lines.
**Where**: `scripts/quality-reports.mjs`
**Depends on**: T13
**Reuses**: `scripts/lib/collect.mjs` (unchanged reader)
**Requirement**: HF-07

**Done when**:

- [x] `summarize` test: a Vitest JSON with 2 pending and 1 todo test gives `skipped` 3
- [x] `pnpm quality:reports` writes `reports/depcruise.json`, `reports/eslint.json`, `reports/tests-summary.json` and `pnpm quality:collect` prints values for `arch.violations`, `lint.warnings`, `tests.skipped`
- [x] `ci.yml` keeps `pnpm run lint`, `pnpm run arch` and `pnpm test`; only the `|| true` report-writing lines go, and the ratchet step calls `pnpm run quality:gate`
- [x] Gate check passes: `pnpm test:harness && pnpm quality:reports && pnpm quality:collect`

**Tests**: unit
**Gate**: quick

---

### T15: Add the release-please configuration for the agent

**What**: `release-please-config.json` and `.release-please-manifest.json` as in design.md.
**Where**: `release-please-config.json`
**Depends on**: T14
**Reuses**: none
**Requirement**: HF-11

**Done when**:

- [x] Exactly one package (`apps/agent`), release type `node`, component `agent`, tag separator `-`, `include-v-in-tag` true; manifest maps `apps/agent` to `0.0.0`
- [x] Gate check passes: `pnpm format:check`

**Tests**: none
**Gate**: build

---

#### Phase 4: Acceptance and baseline

### T16: Implement the acceptance steps for harness-foundation

**What**: `tests/acceptance/steps/harness-foundation.steps.ts` implementing every step of `acceptance.feature` as a black box (child processes and file reads only).
**Where**: `tests/acceptance/steps/harness-foundation.steps.ts`
**Depends on**: T15
**Reuses**: `tests/acceptance/fixtures.ts`
**Requirement**: HF-01, HF-02, HF-03, HF-04, HF-05, HF-07, HF-08, HF-11

**Done when**:

- [x] `bddgen` generates with no missing step; every scenario except `@HF-07` passes (HF-07 passes after T17)
- [x] No import from `apps/` or `packages/(telemetry|config)`; `pnpm arch` exits 0
- [x] Gate check passes: `pnpm --filter @d2rmm/acceptance typecheck && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep-invert @HF-07`

**Tests**: e2e
**Gate**: full

---

### T17: Record the first measured quality baseline

**What**: Run `pnpm quality:reports`, `pnpm test:mutation`, `pnpm harness:json`, `pnpm quality:collect` and `pnpm quality:ratchet --context phase --update`, and commit the `.quality-baseline.json` diff.
**Where**: `.quality-baseline.json`
**Depends on**: T16
**Reuses**: `scripts/quality-ratchet.mjs`
**Requirement**: HF-07, HF-08

**Done when**:

- [x] `arch.violations`, `lint.warnings`, `tests.skipped`, `mutation.api.domain` are non-null; `mutation.api.application` stays `null` (zero mutants, HF-07 AC 1)
- [x] No `floor` raised or `ceiling` lowered by hand; `ci.duration_seconds` and `load.*` stay `null`
- [x] Gate check passes: `pnpm harness:gate && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test`

**Tests**: e2e
**Gate**: full

---

#### Phase 5: Verifier findings (round 1)

### T18: Prove `FakeClock` copies the dates it is given

**What**: Tests in `clock.test.ts` that mutate the caller's `Date` after construction and after `set`, and assert `now()` is unchanged (verification.md findings M1, M2).
**Where**: `apps/api/src/shared-kernel/clock.test.ts`
**Depends on**: T17
**Reuses**: T10 tests
**Requirement**: HF-06

**Done when**:

- [x] A test mutates the start `Date` after `new FakeClock(start)` and asserts `now()` still equals the original instant
- [x] A test mutates the argument after `set(date)` and asserts `now()` still equals the set instant
- [x] Gate check passes: `pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 21 tests pass in `@d2rmm/api` (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T19: Prove the Stryker mutate lists and the live per-layer thresholds

**What**: Tests asserting the literal `layerConfig('domain').mutate` and `layerConfig('application').mutate` arrays (with the `!src/**/*.test.ts` exclusion), and that the config exported by `stryker.config.mjs` carries `thresholds.break` 80 for domain and 70 for application (verification.md finding M3 and HF-06 AC 4). `stryker.config.mjs` changes only if it cannot be imported in a test, with identical behaviour.
**Where**: `apps/api/scripts/mutation-plan.test.ts`
**Depends on**: T18
**Reuses**: T12 `layerConfig`
**Requirement**: HF-06

**Done when**:

- [x] The `mutate` arrays of both layers are asserted literally
- [x] The config `stryker.config.mjs` exports for each layer is asserted to break at 80 (domain) and 70 (application)
- [x] Gate check passes: `pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 24 tests pass in `@d2rmm/api` (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T20: Count node:test proofs and fail on zero tests

**What**: `scripts/lib/count-reporter.mjs`, a node:test custom reporter that prints each test's result and a final `<n> passed`, and fails the run when no test ran or one failed; `scripts/test/count-reporter.test.mjs` runs it on a fixture under `scripts/test/fixtures/count-reporter/` that `pnpm test:harness` does not pick up (verification.md finding 6; C5–C8 use it).
**Where**: `scripts/lib/count-reporter.mjs`
**Depends on**: T19
**Reuses**: none
**Requirement**: HF-03

**Done when**:

- [x] Tests: a matching name pattern exits 0 and prints `1 passed`; a pattern matching nothing exits non-zero; a failing fixture test exits non-zero
- [x] `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain-is-pure" scripts/test/arch-fixtures.test.mjs` exits 0 and prints `1 passed`
- [x] Gate check passes: `pnpm test:harness && pnpm lint && pnpm format:check`
- [x] Test count: ≥ 3 new tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T21: Prove the count reporter fails a run with a failing test among passing ones

**What**: A fixture with one passing and one failing test, and a test in `count-reporter.test.mjs` asserting the run exits non-zero and prints `1 passed` (verification.md finding 7, mutation M9).
**Where**: `scripts/test/count-reporter.test.mjs`
**Depends on**: T20
**Reuses**: T20 reporter and fixtures
**Requirement**: HF-03

**Done when**:

- [x] A `*.fixture.mjs` file under `scripts/test/fixtures/count-reporter/` has one passing and one failing test and is not matched by the `pnpm test:harness` glob
- [x] A test runs the reporter on it and asserts a non-zero exit and `1 passed` in the output
- [x] Gate check passes: `pnpm test:harness && pnpm lint && pnpm format:check`
- [x] Test count: ≥ 80 harness tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T22: Unit-test the count reporter on a synthetic event stream

**What**: A test in `count-reporter.test.mjs` that imports the reporter and drives it with an in-memory event stream shaped like Node's runner events (leaf tests, not suites or file-level events). A mixed stream has one passing and one failing leaf; the test asserts the output ends with `1 passed` and that the reporter set `process.exitCode` to 1, and restores `process.exitCode` afterwards. A passing stream with one passing leaf leaves `process.exitCode` unset. The Node test runner already exits non-zero on any failure, so only a direct test sees the reporter's own failure handling (verification.md finding 7, mutation M9; T21's subprocess test cannot kill it).
**Where**: `scripts/test/count-reporter.test.mjs`
**Depends on**: T21
**Reuses**: T20 reporter
**Requirement**: HF-03

**Done when**:

- [x] Mixed stream (one pass, one fail): output contains `1 passed` and `process.exitCode` is 1
- [x] Passing stream (one pass): `process.exitCode` is not set to a failure
- [x] `process.exitCode` is restored after each case, so the harness run itself is not failed
- [x] Gate check passes: `pnpm test:harness && pnpm lint && pnpm format:check`
- [x] Test count: ≥ 82 harness tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

## Checks

**C1** - `pnpm ls -r --depth -1` lists the six `@d2rmm/*` workspaces (HF-01, AC 1)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-01"`

**C2** - `pnpm build`, `pnpm typecheck` and `pnpm test` exit 0 and run in all six workspaces (HF-01, AC 2)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-01"`

**C3** - Every TypeScript workspace extends the `@d2rmm/config` TypeScript preset and the root ESLint and Prettier configs come from `@d2rmm/config` (HF-02, AC 3)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-02"`

**C4** - The presets keep the strict TypeScript flags and the purity and enum lint rules (HF-02, AC 3)
Proof: `pnpm --filter @d2rmm/config exec vitest run test/presets.test.ts`

**C5** - A domain file importing an adapter fails with rule `domain-is-pure` (HF-03, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain-is-pure" scripts/test/arch-fixtures.test.mjs`

**C6** - An application file importing an adapter fails with rule `application-no-adapters` (HF-03, AC 4)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="application-no-adapters" scripts/test/arch-fixtures.test.mjs`

**C7** - A module importing another module's internal fails with rule `no-cross-module-internals` (HF-03, AC 5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="no-cross-module-internals" scripts/test/arch-fixtures.test.mjs`

**C8** - A module file importing `main/` fails with rule `nobody-imports-main` (HF-03, AC 6)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="nobody-imports-main" scripts/test/arch-fixtures.test.mjs`

**C9** - `pnpm contracts:check` exits 0 with no diff; OpenAPI 3.1 with no paths, AsyncAPI 3.0 with no channels (HF-04, AC 4)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-04"`

**C10** - The five modules each have `domain`, `application`, `adapters` and `index.ts`, and `pnpm arch` reports 0 errors with the fixtures present (HF-05, AC 1, 2, 7)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-05"`

**C11** - `Result`, `FakeClock` and `SequentialIdGenerator` behave as specified (HF-06, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel`

**C12** - `pnpm test:mutation` writes `reports/mutation/api-domain/mutation.json` and `reports/mutation/api-application/mutation.json` (HF-06, AC 2, 3)
Proof: `pnpm --filter @d2rmm/api test:mutation && node -e "for (const l of ['domain','application']) require('node:fs').accessSync('reports/mutation/api-'+l+'/mutation.json')"`

**C13** - Domain mutation breaks under 80% and application under 70% (HF-06, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run scripts/mutation-plan.test.ts -t "break threshold"`

**C14** - The baseline holds measured values for `arch.violations`, `lint.warnings`, `tests.skipped` and `mutation.api.domain` (HF-07, AC 1)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-07"`

**C15** - `mutation.api.application`, `ci.duration_seconds` and the `load.*` metrics stay `null` after the update (HF-07, AC 1, 2)
Proof: `node -e "const m=require('./.quality-baseline.json').metrics; const k=Object.keys(m).filter(n=>n==='mutation.api.application'||n==='ci.duration_seconds'||n.startsWith('load.')); process.exit(k.every(n=>m[n].value===null)?0:1)"`

**C16** - `pnpm harness:gate` exits 0 (HF-08, AC 3)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-08"`

**C17** - With no application source file, `pnpm test:mutation` exits 0 and writes an application report with zero mutants (HF-09, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run scripts/mutation-plan.test.ts -t "empty layer"`

**C18** - The first `ci.yml` run on the maintainer's PR is green for `verify`, `integration` and `secrets` (HF-10, AC 1)
Proof: walk - the maintainer pushes `phase/F0` after the phase review and the PR checks page shows the three jobs green (queued in `.specs/phases/F0/review.md`)

**C19** - `apps/agent` is the only released package, tags `agent-v<version>`, starting at `0.0.0` (HF-11, AC 1, 2)
Proof: `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-11"`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** review-spec (prior session, no recorded verdict); review-spec at f67c607^ → FAIL; review-spec retry 1 → PASS (spec committed f67c607); review-architecture on design draft → FAIL (findings applied in the rewritten design.md, not yet re-reviewed); execute-batch-1 (T1–T7) at the tasks commit → pending; execute-batch-1 attempt 1 → stopped at T1 (invocation error, see below); execute-batch-1 retry 1 at 02ff3ec + uncommitted T1 files → pending; execute-batch-1 retry 1 → T1 gate passed (6 tests), commit refused by pre-commit `unit-related` (no root Vitest yet); replanned: T3 (root Vitest) runs first, T2 gate adds the config typecheck; tasks gate passed again. Next: execute-batch-1 retry 2 (T3, then commit T1 from the uncommitted files, then T2, T4–T7)
**Walked:** none

**execute-batch-1 retry 2 (2026-10-30)** — T3 ddb36eb, T1 814665b, T2 d048c4c committed, gates passed. T2's "`pnpm arch` still starts" was unsatisfiable before `apps/` exists (`Can't open 'apps' for reading`). Orchestrator replan: that check moves to T4, whose gate now ends with `&& pnpm arch`; tasks gate re-run. Next: execute-batch-1 continues with T4–T7.

**Unblocked (2026-10-30), verification** — the maintainer reset `gate:harness-foundation/verification` (by pedromoraisf). Orchestrator replan for finding 6: C5–C8 proofs run with `--test-reporter=./scripts/lib/count-reporter.mjs`, a node:test reporter that prints `<n> passed` and fails on zero tests, so a renamed test turns the proof red; tasks gate re-run. Next: execute-batch-4 closes the six findings, then `check_proofs.py --mutations`, verify-r2, and the verification gate run once.

**BLOCKED (2026-10-30), verification** — batches 2 and 3 done (T8–T17); proofs 23/23 (69cab66). Verifier (67839ea) → FAIL, 6 findings, round 2 applies: M1/M2 `FakeClock` aliases the start and `set` dates (clock.ts:11,23); M3 `layerConfig().mutate` unasserted (mutation-plan.ts:38); HF-06 AC4 thresholds not proven wired into `stryker.config.mjs`; domain 100% rests on 7 valid mutants; C5–C8 `--test-name-pattern` passes on zero matches. The Verifier ran `validate_verification.py` three times before any fix, so `gate:harness-foundation/verification` is blocked. Root cause (orchestrator): the verify prompt did not say the gate runs once, after the fix batch. T16's out-of-Where changes (scenario fixture, @types/node, tsconfig types, env.d.ts removed) were judged acceptable. Next after a maintainer reset: execute-batch-4 with the findings as tasks → `check_proofs.py --mutations` → verify-r2 → verification gate.

**Unblocked (2026-10-30)** — the maintainer reset `dispatch:harness-foundation/execute-batch-1` (by pedromoraisf). Re-dispatched: execute-batch-1 for T4–T7 at HEAD.

**BLOCKED (2026-10-30)** — `dispatch:harness-foundation/execute-batch-1` used its 3 dispatches; the gate refused the fourth (T4–T7). T4–T7 not started; HEAD 1a7b577, worktree clean. Feature blocked until the maintainer resets the unit (`attempt.mjs reset --unit dispatch:harness-foundation/execute-batch-1 --by <maintainer>`) or picks another route. Recorded in `.specs/phases/F0/decisions.md` → Blocked.

**Batch-1 worker stopped (2026-10-30), not a T1 failure** — orchestrator root cause: each call appended `; echo EXIT=$?` after the quoted gate, a second command outside the wrapper, so the hook refused it; the gate command itself is valid (quoted `&&` is stripped before splitting). The ledger has no `gate:harness-foundation/T1` unit and `dispatch:harness-foundation/execute-batch-1` shows 0 failures. Re-dispatched as execute-batch-1 retry 1 with the exact invocation form. Worker notes as written:

- Last error: the PreToolUse gate denied every `node scripts/attempt.mjs run --feature harness-foundation --step T1 -- "<cmd>"` call with `[d2rmm gate] Quote the whole gate command after "--" so nothing runs outside the attempt wrapper` (denials 1/3, 2/3, 3/3). Denials 1 and 2 used the gate command `pnpm install && pnpm --filter @d2rmm/config test` (denial 1 came in a call whose heredoc also contained the words `vitest` and `eslint`); denial 3 used `pnpm --filter @d2rmm/config test` alone. The session is now exhausted (`Retry budget exhausted for this agent session (2 retries used)`), so no further gate ran.
- Attempts: none recorded in `.git/d2rmm/ledger.json` for `gate:harness-foundation/T1` (the wrapper never executed the command). Prior to the denials the worker ran `pnpm install` directly (setup, registry reachable; lockfile updated, `pnpm-lock.yaml` modified) and wrote the T1 files, uncommitted: `packages/config/{package.json,tsconfig.json,tsconfig.base.json,tsconfig.dom.json,eslint.mjs,prettier.json,test/presets.test.ts}`.
- Changed for T1 so far: the preset copies of the root configs (`tsconfig.base.json` + the two options, `eslint.config.mjs` → `eslint.mjs` with the four ignores, `.prettierrc.json` → `prettier.json`); verified with `git diff --no-index` that the only differences are the allowed additions. The root files are untouched (T2 has not started).
- Tasks T1–T7: none committed, none marked done.
- Next step for the orchestrator: check whether the gate hook expects a different wrapper form for the `&&` gate command (the tasks.md gate for T1 is a two-segment command), or reset the unit with `attempt.mjs reset --unit gate:harness-foundation/T1 --by <maintainer>` after the hook is understood. The T1 test itself has not been run and may need fixes once it is.

**Unblocked (2026-10-30)** — the maintainer reset `dispatch:harness-foundation/review-spec` after it used its 3 dispatches on the HF-07 vs HF-09 amendment (maintainer's words: "I approve the amendment", recorded in `.specs/phases/F0/decisions.md`). Re-dispatched: review-spec (amendment) and review-architecture retry 1, in parallel.

**execute-batch-1 retry 1 — T1 commit blocked by plan order (2026-10-30), not a gate failure**

- Gate `gate:harness-foundation/T1`, attempt 1/3: passed (`pnpm install && pnpm --filter @d2rmm/config test`, 6 tests). T1 checkboxes are marked in the worktree.
- Commit refused by lefthook `pre-commit` `unit-related`: it runs `pnpm exec vitest related --run --passWithNoTests` at the root for any staged `packages/**/*.ts`. The root has no Vitest (`node_modules/.bin/vitest` absent), so the hook exits 254 with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`. Root Vitest is T3's deliverable, and T3 comes after T1.
- State: T1 files and the lockfile are staged, not committed. No `--no-verify`, no hook change. T2–T7 not started.
- Needed from the orchestrator: order root Vitest (T3) before the first commit that stages `packages/**/*.ts`, or decide another route. The worker did not change the plan.

**execute-batch-1 (batch 1, 2026-10-30) — stopped after T2 (plan order, not a T2 gate failure)**

- T3 done: root Vitest config and devDependency; gate passed on attempt 1 (6 tests).
- T1 done: presets commit; gate passed on attempt 2 (6 tests). The ledger counts the earlier denied run as attempt 1.
- T2 gate passed on attempt 2 (lint, format, config typecheck, 6 tests). Attempt 1 failed the config typecheck: `packages/config/test/presets.test.ts` uses `node:fs`, `URL` and `import.meta.url`, and the package had no Node types. Fixed in the package by adding `@types/node@^26.6.6` as a devDependency. The test was not changed.
- T2 Done-when `pnpm arch still starts` is open and cannot pass before T4. `depcruise apps packages tests` exits with `Can't open 'apps' for reading`; `apps/` does not exist until T4 creates `apps/web`. The arch run was a separate wrapper call and counted as failure 2/3 on `gate:harness-foundation/T2` (1 retry left). The T2 gate itself passed. Decision for the orchestrator: move the arch check to T4 or later, or accept it as deferred.
- Deviation: T2 `What` lists root `tsconfig.base.json`, root `package.json` and `.prettierrc.json`, while `Where` lists only `eslint.config.mjs`. All `What` items were implemented, following design.md lines 81–85.
- Not started: T4, T5, T6, T7 (stopped at the T2 arch item, per the stop rule).

**execute-batch-2 (2026-10-30) — T8–T12 committed (T8 d6b548c, T9 cc5eea7, T10 192a672, T11 8e1c00a, T12 in this commit)**

- T12 gate passed on attempt 3 of 3, which used the whole budget for `gate:harness-foundation/T12`. Failure 1: the gate command has no `pnpm install`, so the new Stryker packages were not linked. Setup `pnpm install` was run directly, not as a gate. Failure 2: Stryker's default `@stryker-mutator/*` plugin glob scans the pnpm store and cannot find `typescript-checker`. Fix: `plugins` set explicitly in `apps/api/stryker.config.mjs`.
- Domain mutation score 100.00 (7 killed, 0 survived, 12 excluded as compile errors by the TypeScript checker, so the score rests on 7 valid mutants). Application: zero mutants, `null` in the baseline.
- Recommendation for the orchestrator: add `pnpm install` to the T12 gate in tasks.md (or to the gate of any task that adds dependencies).

execute-batch-4 attempt 1 stopped on a manual mutant probe the orchestrator asked for; the probe moved to `check_proofs.py --mutations`; retried.

**Finding 7 not killed by T21 (2026-10-30)** — proofs with mutations at 8f452ca: 23 pass, 8 killed, M9 not killed (proofs failure 1/3). Root cause (orchestrator): the Node test runner exits non-zero on any failing test regardless of the reporter, so a subprocess test cannot observe the reporter's `anyFailure` branch. Planned T22, a direct test of the reporter on a synthetic event stream; tasks gate re-run.

**Round 2 (2026-10-30)** — proofs with mutations: 23 pass, 6 killed (e859e80). verify-r2 (62fa323): round-1 findings 1–4 and 6 closed, 5 accepted as an observation; new finding 7 (`count-reporter.mjs:39`, mutant M9 survives: no test has a failing test among passing ones). Planned as T21; tasks gate re-run. Next: execute-batch-5 (T21), proofs with mutations, fill `Closed`, verification gate once.

**Replanned (2026-10-30), verifier findings** — orchestrator root cause: the fix prompt named gate steps (`fix-clock`, `fix-mutation`, `fix-count`) that are not task ids. The findings are now tasks T18–T20 (Phase 5); tasks gate re-run. Next: execute-batch-4 retry 2 runs T18–T20 with their task ids.

**BLOCKED (2026-10-30), execute-batch-4 retry, fix F1 (verification findings M1/M2)** — `attempt.mjs run --step fix-clock` is rejected before the command runs: "step \"fix-clock\" is not a task id in tasks.md nor one of: spec, design, tasks, proofs, verification, integration". Steps must be task ids from `tasks.md` or the fixed steps, so the gate cannot be recorded under a fix name. Reusing `T10` would charge the fix to T10's budget, which the rules do not allow. No gate attempt was recorded and no budget was spent. Changes so far, uncommitted: `apps/api/src/shared-kernel/clock.test.ts` (the two M1/M2 tests, prettier-clean; they mutate the caller's `Date` after construction and after `set` and assert `now()` unchanged). `clock.ts` is untouched. F2 and F3 not started (stop rule: the batch stops at the first impossible fix). Next: the orchestrator either names a step the wrapper accepts for F1 or adds a fix step to the tasks.md step list, then execute-batch-4 resumes at F1's gate.

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1:  T3 → T1 → T2 → T4 → T5 → T6 → T7
Phase 2:  T8 → T9 → T10 → T11 → T12
Phase 3:  T13 → T14 → T15
Phase 4:  T16 → T17
Phase 5:  T18 → T19 → T20 → T21 → T22
```

Batches: `execute-batch-1` = Phase 1 (7 tasks); `execute-batch-2` = Phase 2 (5 tasks); `execute-batch-3` = Phases 3–4
(5 tasks).
