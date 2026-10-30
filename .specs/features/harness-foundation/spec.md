# Harness Foundation Specification

**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

The pre-foundation delivered the harness (hooks, CI, ratchet, dependency rules, acceptance runner) and installed the
dependencies, but the repository has no workspaces yet: `apps/` and `packages/` do not exist, so dependency-cruiser,
Vitest, Stryker, Turborepo and the quality baseline have nothing to measure. Every later F0 feature needs the six
workspaces, the five API modules with their three layers, and sensors that are proven to fail on a violation.

## Goals

- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` run across six workspaces (three apps, three packages) and exit 0.
- [ ] dependency-cruiser rejects each layer violation of ADR 003/004 from a fixture kept as a test, while `pnpm arch` on
      the real tree reports 0 errors.
- [ ] `pnpm test:mutation` writes a Stryker report for the API domain and one for the API application layer.
- [ ] `.quality-baseline.json` holds first measured values for every metric this feature can measure locally.

## Out of Scope

| Feature                                                           | Reason                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`, `pnpm-lock.yaml`, Prettier/ESLint fixes           | Done before F0 (commit 8648812); this feature keeps them green, it does not redo them                                                                       |
| Playwright pin and first `bddgen` smoke run                       | Done before F0 (commit 8648812); this feature's scenarios are the first committed ones                                                                      |
| Installing Playwright browsers locally                            | No scenario here drives a browser; `ci.yml` installs chromium, and `api-web-skeleton` brings the first browser scenario                                     |
| Pushing to GitHub and the first green `ci.yml` run                | A push is an escalation (AGENTS.md rule 7); queued for the maintainer, see HF-10                                                                            |
| Rust crate `apps/agent/src-tauri`, capture, pairing, updater      | `agent-skeleton` (ADR 010/011/015)                                                                                                                          |
| `release-please.yml` workflow, tauri-action, release tags         | `agent-skeleton` (ADR 015); this feature ships only the release-please config                                                                               |
| Fastify server, `main/local.ts`, `main/render.ts`, `GET /healthz` | `api-web-skeleton` (ADR 002/005)                                                                                                                            |
| Real routes and schemas in `openapi.json` / `asyncapi.json`       | `api-web-skeleton` (ADR 020); this feature generates the empty documents                                                                                    |
| Telemetry SDK wiring and spans                                    | `observability-e2e` (ADR 013); `packages/telemetry` is an empty workspace here                                                                              |
| CI time and load baseline values                                  | `ci.duration_seconds` is set from the first CI run after the maintainer's push (HF-10, recorded in the phase review); load values come from `load-baseline` |

---

## Assumptions & Open Questions

| Assumption / decision                                               | Chosen default                                                                                                                                                                                                                                                                                   | Rationale                                                                                                                                                           | Confirmed? |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| What "empty workspace" means for `apps/agent`                       | `apps/agent` is the TypeScript UI workspace only (`package.json`, no `src-tauri/`)                                                                                                                                                                                                               | `ci.yml` turns the Rust job on when `apps/agent/src-tauri/Cargo.toml` exists; the crate belongs to `agent-skeleton`. AD-026 (assumed)                               | y (AD-026) |
| What the domain mutation report mutates before any aggregate exists | The shared kernel (`Result`, `Clock`, `IdGenerator`) is written here with its unit tests; the domain Stryker run mutates `src/modules/*/domain/**` and `src/shared-kernel/**`                                                                                                                    | Without code, Stryker reports no score and the exit criterion "a domain mutation report" has no proof. The shared kernel is pure, like the domain. AD-027 (assumed) | y (AD-027) |
| Release-please scope                                                | Config and manifest for the `apps/agent` package only (component `agent`, tag `agent-v*`, start version `0.0.0`); no workflow                                                                                                                                                                    | ADR 015 releases only the agent; the workflow pushes tags and belongs with the release pipeline in `agent-skeleton`. AD-028 (assumed)                               | y (AD-028) |
| How acceptance scenarios observe a developer-tooling feature        | Scenarios describe what a contributor runs and observes; step definitions run the repository commands in a child process and assert on exit code and output                                                                                                                                      | ADR 023 requires executable scenarios; this feature has no screen or API. No browser is needed                                                                      | y          |
| Which metrics get their first value here                            | `arch.violations`, `lint.warnings`, `tests.skipped`, `mutation.api.domain` (plus the harness metrics, already measured); `mutation.api.application` stays `null` while the application layer has no mutant (HF-09) and gets its first value with the first application code (`api-web-skeleton`) | These are measurable locally; CI time and load need GitHub and k6                                                                                                   | y          |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Six workspaces build together ⭐ MVP

**User Story**: As a contributor, I want the six workspaces of ADR 001 to exist and build together so that every later
feature adds code to a known place and every sensor has something to run on.

**Why P1**: Every other F0 feature writes into these workspaces.

**Acceptance Criteria**:

1. The repository SHALL contain the workspaces `@d2rmm/web` (`apps/web`), `@d2rmm/api` (`apps/api`), `@d2rmm/agent` (`apps/agent`), `@d2rmm/contracts` (`packages/contracts`), `@d2rmm/telemetry` (`packages/telemetry`) and `@d2rmm/config` (`packages/config`), each listed by `pnpm ls -r --depth -1`.
2. WHEN a contributor runs `pnpm build`, `pnpm typecheck` or `pnpm test` from the repository root THEN each command SHALL run in all six workspaces and exit 0.
3. Every TypeScript workspace SHALL extend the TypeScript preset exported by `@d2rmm/config`, and the root ESLint and Prettier configuration SHALL come from the presets exported by `@d2rmm/config`.
4. WHEN a contributor runs `pnpm contracts:check` THEN `@d2rmm/contracts` SHALL regenerate `packages/contracts/openapi.json` (OpenAPI 3.1, no paths) and `packages/contracts/asyncapi.json` (AsyncAPI 3.0, no channels) and the command SHALL exit 0 with no diff.

**Independent Test**: run `pnpm build`, `pnpm typecheck` and `pnpm test` on a clean checkout; each exits 0 and the
Turborepo summary lists six packages.

---

### P1: Layers that the sensors enforce ⭐ MVP

**User Story**: As the maintainer, I want the five API modules to exist with their three layers and dependency-cruiser
to fail on a deliberate violation kept as a test so that the architecture rules are proven, not assumed.

**Why P1**: Exit criterion of F0 and the base of every later module.

**Acceptance Criteria**:

1. `apps/api/src/modules/` SHALL contain the modules `identity`, `agents`, `matchmaking`, `lobby-room` and `ranking`, each with the folders `domain`, `application` and `adapters` and a public `index.ts`.
2. WHEN a contributor runs `pnpm arch` on the repository THEN dependency-cruiser SHALL report 0 errors and exit 0.
3. WHEN dependency-cruiser runs with the repository's `.dependency-cruiser.cjs` on the violation fixture where a `domain` file imports an `adapters` file THEN it SHALL exit non-zero and report the rule `domain-is-pure`.
4. WHEN dependency-cruiser runs with the repository's `.dependency-cruiser.cjs` on the violation fixture where an `application` file imports an `adapters` file THEN it SHALL exit non-zero and report the rule `application-no-adapters`.
5. WHEN dependency-cruiser runs with the repository's `.dependency-cruiser.cjs` on the violation fixture where one module imports another module's internal file THEN it SHALL exit non-zero and report the rule `no-cross-module-internals`.
6. WHEN dependency-cruiser runs with the repository's `.dependency-cruiser.cjs` on the violation fixture where a module file imports `main/` THEN it SHALL exit non-zero and report the rule `nobody-imports-main`.
7. IF the violation fixtures are present in the repository THEN `pnpm arch` on the real tree SHALL still report 0 errors: the fixtures live under `scripts/test/fixtures/arch/<violation>/`, outside the paths `pnpm arch` scans (`apps packages tests`), each mirroring the `apps/api/src/...` layout, and their test runs dependency-cruiser with the fixture folder as working directory and the repository's `.dependency-cruiser.cjs` rules, so the `^apps/api/src` paths of the rules match.

**Independent Test**: `pnpm arch` exits 0; the fixture test (`pnpm test:harness`) passes and fails when any one
fixture import is removed.

---

### P1: Test pyramid with mutation on the domain ⭐ MVP

**User Story**: As the maintainer, I want unit tests and mutation testing wired for the API domain and application
layers so that NFR-10 is measured from the first commit of real code.

**Why P1**: NFR-10 and ADR 014; the quality baseline needs the first mutation value.

**Acceptance Criteria**:

1. The shared kernel SHALL export `Result` (`ok`, `err`, `isOk`, `isErr`), a `Clock` port with a `FakeClock`, and an `IdGenerator` port with a deterministic fake, each covered by Vitest unit tests.
2. WHEN a contributor runs `pnpm test:mutation` THEN Stryker SHALL write `reports/mutation/api-domain/mutation.json` for the files under `apps/api/src/modules/*/domain/**` and `apps/api/src/shared-kernel/**`.
3. WHEN a contributor runs `pnpm test:mutation` THEN Stryker SHALL write `reports/mutation/api-application/mutation.json` for the files under `apps/api/src/modules/*/application/**`.
4. IF the domain mutation score is below 80% or the application score is below 70% THEN `pnpm test:mutation` SHALL exit non-zero (Stryker `thresholds.break`, ADR 014).
5. IF the application layer has no source file to mutate THEN `pnpm test:mutation` SHALL still exit 0 and write an application report with zero mutants.

**Independent Test**: `pnpm test:mutation` exits 0 and both report files exist; lowering a shared-kernel test so that
a mutant survives drops the domain score.

---

### P2: First measured quality baseline

**User Story**: As the maintainer, I want the quality baseline to hold real numbers so that the ratchet tightens from
measurements rather than from `null`.

**Why P2**: Exit criterion of F0; needs the P1 stories first.

**Acceptance Criteria**:

1. WHEN `pnpm quality:collect && pnpm quality:ratchet --context phase --update` runs on the finished feature branch THEN `.quality-baseline.json` SHALL hold non-null values for `arch.violations`, `lint.warnings`, `tests.skipped` and `mutation.api.domain`, and `mutation.api.application` SHALL stay `null` because its report has zero mutants (HF-09; the collector scores zero mutants as not measured).
2. The update SHALL not raise any `floor` or lower any `ceiling` beyond what the ratchet computes, and SHALL leave `ci.duration_seconds` and the `load.*` metrics at `null`.
3. WHEN a contributor runs `pnpm harness:gate` after this feature THEN it SHALL exit 0 (harness-score level 4, NFR-11).

**Independent Test**: diff of `.quality-baseline.json` shows only the four values set and `harness:gate` exits 0.

---

### P2: Release configuration for the agent

**User Story**: As the maintainer, I want release-please configured for the agent so that `agent-skeleton` only adds
the workflow and the first release follows Conventional Commits.

**Why P2**: ADR 015 needs it before `v0.0.1`; nothing else depends on it in this feature.

**Acceptance Criteria**:

1. The repository SHALL contain `release-please-config.json` with exactly one package, `apps/agent`, of release type `node`, component `agent`, tag separator `-` and `include-v-in-tag: true`, so that its tags read `agent-v<version>`.
2. The repository SHALL contain `.release-please-manifest.json` mapping `apps/agent` to `0.0.0`.

**Independent Test**: parse both JSON files and check the fields; `apps/agent/package.json` version is `0.0.0`.

---

### P3: First CI run on GitHub

**User Story**: As the maintainer, I want the first `ci.yml` run on GitHub to be green so that F0's exit criterion
"builds in CI" has its proof.

**Why P3**: Needs a push, which only the maintainer authorizes; everything it runs is green locally first. HF-10 does not block this feature's done status: it is queued for the maintainer in the phase review.

**Acceptance Criteria**:

1. WHEN the maintainer pushes the phase branch and opens the PR THEN the `ci.yml` jobs `verify`, `integration` and `secrets` SHALL finish green (the `agent` job stays skipped because no `Cargo.toml` exists yet).

**Independent Test**: the PR's checks page.

---

## Edge Cases

- IF a workspace has no test files THEN `pnpm test` SHALL still exit 0 for it (Vitest `passWithNoTests`), and `tests.skipped` SHALL stay 0.
- IF a module folder is empty THEN git SHALL still keep it (each layer folder holds its `index.ts` or a `.gitkeep`), so dependency-cruiser and Stryker globs stay valid.
- IF a contributor adds a violation to the real tree THEN `pnpm arch` SHALL exit non-zero (covered by HF-03, HF-05 and the existing pre-commit `arch` hook).

---

## Implicit-requirement dimensions

| Dimension                                | Resolution                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Input validation & bounds                | N/A because the feature adds no input surface                                                    |
| Failure / partial-failure states         | HF-03 (each violation fails), HF-06 (thresholds break the run), HF-09 (empty layer still green)  |
| Idempotency / retry / duplicate handling | HF-04: regenerating contracts twice yields no diff                                               |
| Auth boundaries & rate limits            | N/A because nothing is served                                                                    |
| Concurrency / ordering                   | N/A because Turborepo orders tasks from `turbo.json`; no runtime concurrency is added            |
| Data lifecycle / expiry                  | N/A because no data is stored; reports under `reports/` are gitignored build output              |
| Observability                            | N/A because no request path, job or agent loop is added (telemetry starts in `api-web-skeleton`) |
| External-dependency failure              | HF-10 is the only external dependency (GitHub Actions), proved after the maintainer's push       |
| State-transition integrity               | N/A because no state machine is added                                                            |

---

## Requirement Traceability

| Requirement ID | Story                                           | Phase | Status                               |
| -------------- | ----------------------------------------------- | ----- | ------------------------------------ |
| HF-01          | P1: Six workspaces build together (AC 1-2)      | Tasks | Mapped (T3-T6, T16)                  |
| HF-02          | P1: Six workspaces build together (AC 3)        | Tasks | Mapped (T1, T2)                      |
| HF-03          | P1: Layers that the sensors enforce (AC 3-6)    | Tasks | Mapped (T13)                         |
| HF-04          | P1: Six workspaces build together (AC 4)        | Tasks | Mapped (T7)                          |
| HF-05          | P1: Layers that the sensors enforce (AC 1-2, 7) | Tasks | Mapped (T8, T13)                     |
| HF-06          | P1: Test pyramid with mutation (AC 1-4)         | Tasks | Mapped (T9-T12)                      |
| HF-07          | P2: First measured quality baseline (AC 1-2)    | Tasks | Mapped (T14, T17)                    |
| HF-08          | P2: First measured quality baseline (AC 3)      | Tasks | Mapped (T17)                         |
| HF-09          | P1: Test pyramid with mutation (AC 5)           | Tasks | Mapped (T12)                         |
| HF-10          | P3: First CI run on GitHub                      | -     | Queued (needs the maintainer's push) |
| HF-11          | P2: Release configuration for the agent         | Tasks | Mapped (T15)                         |

**Coverage:** 11 total, 10 mapped to tasks, 1 unmapped ⚠️ (HF-10: proved by the first CI run after the maintainer's push)

---

## Sources

- `docs/product/prd.md#NFR-10` - test pyramid with mutation on domain and application → HF-06, HF-09
- `docs/product/prd.md#NFR-11` - harness L4 verified in CI → HF-08, HF-10
- ADR 001 (public monorepo) - the six workspaces and Turborepo → HF-01, HF-02
- `.specs/phases/F0/brief.md` ("harness-foundation therefore covers": `packages/config` presets) → HF-02
- ADR 003 (layers) - `domain` / `application` / `adapters` per module → HF-05
- ADR 004 (dependency rules) - rules enforced by `.dependency-cruiser.cjs` → HF-03, HF-05
- ADR 014 (testing and mutation) - Vitest, Stryker floors 80% domain / 70% application → HF-06, HF-09
- ADR 015 (agent release) - release-please tags `agent-v*` → HF-11
- ADR 019 (harness L4) - `harness-score --min-level 4` → HF-08
- ADR 020 (OpenAPI generated) - contracts regenerated and drift-checked → HF-04
- ADR 021 (automated phase delivery) - quality ratchet first values → HF-07
- `.specs/phases/F0/brief.md` - harness-foundation scope paragraph and exit criteria → all
- AD-026, AD-027, AD-028 (assumed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] `pnpm check` exits 0 on the feature branch with the six workspaces in place.
- [ ] Removing any one fixture import makes the fixture test fail.
- [ ] `.quality-baseline.json` has four new non-null values and nothing loosened.
