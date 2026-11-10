# CI Fast Path Specification

**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

**Amended by the runner** (assumed, AD-161; to confirm at the phase review): 2026-11-08, Tasks found that Render runs the API from `src/` (`render.yaml` `startCommand`) after `pnpm install --frozen-lockfile --ignore-scripts`, with no compiled build. CFP-25 is appended: the smoke job reproduces those commands, and it replaces the "production build script" and "build's output" clauses of CFP-15. No other criterion is edited.

## Problem Statement

In F0 the PR critical path took 14.9 minutes, 7.7 of them Stryker inside `verify`, which `integration` waits for.
Mutation also ran in the local task loop for 3.0 hours. With merges now autonomous (ADR 028), the required checks are
the only lock before `main`, so they must be fast and must be the right ones. This row takes mutation off the critical
path and out of the task loop, adds smoke checks before merge, fixes the required checks, and slows the Dependabot
majors that broke F0. Source: `.specs/phases/F0/brief-revision-6.md` § 3 (ci-fast-path), approved by the maintainer on
2026-11-07, and AD-142.

## Goals

- [ ] `integration` starts when the fast `verify` ends; mutation runs beside them and blocks no merge.
- [ ] No task gate of an open task runs mutation; mutation runs in the Verifier, the PR jobs and the nightly.
- [ ] The ruleset requires `verify`, `integration`, `agent` and `secrets`.
- [ ] A PR shows whether the API's production build boots and whether the agent's release build compiles.

## Out of Scope

| Feature                                                                            | Reason                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applying `.github/rulesets/main.json` on GitHub                                    | A repository setting; the maintainer's (ADR 028 § 1, brief § 6)                                                                                                                                                      |
| Making `mutation`, `agent-mutation`, `smoke` or `agent-build` required checks      | Brief: not required at first                                                                                                                                                                                         |
| Changing Stryker or cargo-mutants thresholds, the quality baseline or its contexts | Loosening a sensor or the baseline is the maintainer's; none is needed here                                                                                                                                          |
| The phase review reading the nightly mutation report instead of running it locally | The phase-runner skill is `continuous-delivery`'s (brief § 3)                                                                                                                                                        |
| Measuring the median PR critical path                                              | An exit criterion read from the first five PR runs, in the phase review                                                                                                                                              |
| Any product behaviour: API, site, agent or contract changes                        | The row changes workflows, harness scripts, the API's mutation runner (`apps/api/scripts/mutation.ts`, `mutation-plan.ts`) and their tests only; no threshold, glob or layer definition of the mutation plan changes |

---

## Assumptions & Open Questions

| Assumption / decision                                    | Chosen default                                                                                                | Rationale                                                                                                                                                           | Confirmed?          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Where the nightly agent mutation runs                    | `ubuntu-latest`                                                                                               | The brief moves it if the three crates build there: none has Windows-only code, and CI's `integration` job already builds `d2rmm-agent-adapters` on Ubuntu          | n - AD-149, assumed |
| How majors of `eslint*` and `@opentelemetry/*` slow down | One Dependabot group per family for `major` updates, held by a 30-day `cooldown`; minor and patch stay weekly | Dependabot refuses a second `npm` entry for the same directory, so one ecosystem cannot have two schedules; the cooldown gives each major a month before it arrives | n - AD-150, assumed |
| Which tasks the mutation rule checks                     | Open tasks only: a task with at least one unticked `Done when` box                                            | Done tasks of earlier features ran mutation in their gates under the old rules; rewriting their history is not this row's                                           | n - AD-151, assumed |
| Third-party actions in the new jobs                      | Pinned by full commit SHA, as the `agent` job does                                                            | Stricter supply chain; `actions/*` keep the tags the workflow already uses                                                                                          | n - AD-152, assumed |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Mutation leaves the critical path ⭐ MVP

**User Story**: As the runner, I want mutation to run beside the required checks so that a PR's required checks end minutes sooner.

**Why P1**: Stryker is 7.7 of the 14.9 minutes, and `integration` waits for it.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. CFP-01: The `verify` job of `ci.yml` SHALL NOT run `test:mutation`
2. CFP-02: `ci.yml` SHALL hold a job `mutation` that needs only `detect`, runs only on `pull_request` events, and is skipped as a whole when the `detect` output `stryker` (true when `apps/api/stryker.config.*` exists) is not `true`
3. CFP-03: WHEN the `mutation` job runs THEN each API mutation layer SHALL mutate only the files the PR changes relative to its base branch that its own mutate patterns match, and a layer with none SHALL start no Stryker run
4. CFP-04: IF the PR changes no file any layer mutates THEN the `mutation` job SHALL succeed and write `No mutable file changed` to the job summary
5. CFP-05: The `mutation` job SHALL restore and save `apps/api/reports/stryker-incremental-*.json` with `actions/cache`, under a key that starts with `stryker-incremental-<base branch>-` and a restore key of that prefix
6. CFP-06: WHEN Stryker reports survived mutants THEN the `mutation` job SHALL write each one's file, line and mutator to the job summary
7. CFP-07: The `integration` job SHALL need exactly `detect` and `verify`

**Independent Test**: parse `ci.yml` and read the jobs' `needs`, `if` and steps.

---

### P1: Agent mutation on the PR and a Linux nightly ⭐ MVP

**User Story**: As the maintainer, I want the agent's mutants of a PR's diff reported on the PR so that a weak agent test shows up before merge.

**Why P1**: the agent's mutation ran only in the nightly and in local gates.

**Acceptance Criteria**:

1. CFP-08: `ci.yml` SHALL hold a job `agent-mutation` that needs only `detect`, runs only on `pull_request` events when the `detect` output `agent` is `true`, and runs `cargo mutants --in-diff` on the PR's diff for `d2rmm-agent-domain`, `d2rmm-agent-core` and `d2rmm-agent-adapters`, each command ending with `-- --lib` (ADR 026)
2. CFP-09: IF the PR changes no file under `apps/agent/src-tauri/` THEN the `agent-mutation` job SHALL run no `cargo mutants` command
3. CFP-10: The `agent-mutation` job of `nightly.yml` SHALL run on `ubuntu-latest` with its three commands and report paths unchanged

**Independent Test**: parse both workflows and read the agent mutation jobs.

---

### P1: Mutation leaves the task loop ⭐ MVP

**User Story**: As the runner, I want the specs check to refuse a task gate that runs mutation so that a task loop never spends hours on Stryker or cargo-mutants.

**Why P1**: 3.0 hours of F0's task loop were mutation runs.

**Acceptance Criteria**:

1. CFP-11: IF the `**Gate**` line of an open task in any `tasks.md` contains `test:mutation`, `cargo mutants` or `cargo-mutants` THEN `pnpm specs:check` SHALL fail and name the feature and the task id
2. CFP-12: WHEN every `Done when` box of a task is ticked THEN `pnpm specs:check` SHALL NOT flag its gate under CFP-11

**Independent Test**: run the specs check on a fixture tasks.md with an open task whose gate runs `pnpm test:mutation`.

---

### P1: The required checks ⭐ MVP

**User Story**: As the maintainer, I want the ruleset to require every check that guards `main` so that an autonomous merge cannot skip one.

**Why P1**: ADR 028 § 2 makes the required checks the only lock before `main`; today the file requires `verify` and `secrets` only.

**Acceptance Criteria**:

1. CFP-13: The required status checks of `.github/rulesets/main.json` SHALL be exactly `verify`, `integration`, `agent` and `secrets`
2. CFP-14: The jobs `mutation`, `agent-mutation`, `smoke` and `agent-build` SHALL NOT be required status checks

**Independent Test**: parse the ruleset file.

---

### P2: Smoke checks before merge

**User Story**: As the maintainer, I want a PR to boot the API's production build and compile the agent's release so that a deploy-only or release-only failure shows up on the PR.

**Why P2**: in F0 these failures appeared only after the merge to `main`.

**Acceptance Criteria**:

1. CFP-15: `ci.yml` SHALL hold a job `smoke` that runs on `pull_request` events when the `detect` output `api` is `true`, runs the API's production build script, starts a Postgres service container, runs the API's migrations against it, starts the API with `node` from the build's output (not from `src/`) and requests `GET /healthz`
2. CFP-16: IF `GET /healthz` does not answer 200 within 30 seconds of the API's start THEN the `smoke` job SHALL fail
3. CFP-17: `ci.yml` SHALL hold a job `agent-build` on a Windows runner that runs on `pull_request` events when the `detect` output `agent` is `true` and the PR changes a file under `apps/agent/`, and builds the agent with `tauri build` with no signing key in its environment
4. CFP-18: No step of `mutation`, `agent-mutation`, `smoke` or `agent-build` SHALL reference `secrets.` in its `run`, `env` or `with`
5. CFP-19: Every `uses:` of the jobs `mutation`, `agent-mutation`, `smoke` and `agent-build` that is not under `actions/` SHALL be pinned by a full commit SHA
6. CFP-25: The `smoke` job SHALL install the workspace with Render's `buildCommand` install (`pnpm install --frozen-lockfile --ignore-scripts`), run the migrations with `pnpm --filter @d2rmm/api db:migrate` as `deploy-api.yml` does, and start the API with the `startCommand` of `render.yaml`, in place of a production build (AD-161)

**Independent Test**: parse `ci.yml`; the jobs run on the feature's PR.

---

### P2: Slower majors from Dependabot

**User Story**: As the runner, I want majors of the lint and telemetry families to arrive grouped and late so that a phase is not interrupted by breaking upgrades every week.

**Why P2**: majors of `eslint*` and `@opentelemetry/*` broke F0 several times.

**Acceptance Criteria**:

1. CFP-20: `.github/dependabot.yml` SHALL group `major` npm updates of `eslint`, `eslint-*`, `@eslint/*` and `typescript-eslint` in one group, and of `@opentelemetry/*` in another, both listed before `dev-tooling`, so that Dependabot, which puts an update in the first group that matches it, puts those majors in them
2. CFP-21: `.github/dependabot.yml` SHALL hold a `cooldown` of 30 days for `semver-major` updates of those packages
3. CFP-22: The npm schedule SHALL stay `weekly`, and the `playwright` and `dev-tooling` groups SHALL keep their patterns, exclusions and dependency type

**Independent Test**: parse `dependabot.yml`.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want this row to leave the product and the sensors' strictness alone.

**Why P1**: brief revision 6 is harness-only, and loosening a sensor is the maintainer's.

**Acceptance Criteria**:

1. CFP-23: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)
2. CFP-24: The steps `verify` keeps (format, lint, typecheck, architecture, unit tests, TLC self-test, specs, contracts, harness, ratchet) SHALL stay in `verify` with their commands unchanged

**Independent Test**: diff `verify` before and after.

---

## Edge Cases

- CFP-04 covers a PR that touches no mutable file; CFP-09 a PR that touches no agent file.
- CFP-05 covers the first PR against a base branch, with no cache yet: Stryker runs without an incremental file.
- CFP-12 keeps `ci-and-review-fixes`, whose done tasks ran mutation, passing the specs check.
- CFP-16 covers an API that starts but never answers.

---

## Requirement Traceability

| Requirement ID | Story                                 | Phase | Status  |
| -------------- | ------------------------------------- | ----- | ------- |
| CFP-01         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-02         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-03         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-04         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-05         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-06         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-07         | P1: Mutation leaves the critical path | Tasks | Pending |
| CFP-08         | P1: Agent mutation on the PR          | Tasks | Pending |
| CFP-09         | P1: Agent mutation on the PR          | Tasks | Pending |
| CFP-10         | P1: Agent mutation on the PR          | Tasks | Pending |
| CFP-11         | P1: Mutation leaves the task loop     | Tasks | Pending |
| CFP-12         | P1: Mutation leaves the task loop     | Tasks | Pending |
| CFP-13         | P1: The required checks               | Tasks | Pending |
| CFP-14         | P1: The required checks               | Tasks | Pending |
| CFP-15         | P2: Smoke checks before merge         | Tasks | Pending |
| CFP-16         | P2: Smoke checks before merge         | Tasks | Pending |
| CFP-17         | P2: Smoke checks before merge         | Tasks | Pending |
| CFP-18         | P2: Smoke checks before merge         | Tasks | Pending |
| CFP-19         | P2: Smoke checks before merge         | Tasks | Pending |
| CFP-20         | P2: Slower majors from Dependabot     | Tasks | Pending |
| CFP-21         | P2: Slower majors from Dependabot     | Tasks | Pending |
| CFP-22         | P2: Slower majors from Dependabot     | Tasks | Pending |
| CFP-23         | P1: Nothing else changes              | Tasks | Pending |
| CFP-24         | P1: Nothing else changes              | Tasks | Pending |
| CFP-25         | P2: Smoke checks before merge         | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 25 total, 25 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 1 and § 3 (ci-fast-path) - the scope, approved by the maintainer ("Aprovo a revisão do ADR 028.")
- AD-142 in `.specs/STATE.md` - PR mutation becomes a parallel, non-required job held by the nightly and the phase ratchet (CFP-01 to CFP-10)
- ADR 028 § 2 - the required checks are the lock before `main` (CFP-13, CFP-14)
- ADR 014 - mutation testing with Stryker on the API's domain and application (CFP-02 to CFP-06)
- ADR 026 - mutation against unit tests only (CFP-08, CFP-10)
- ADR 020 - contract drift (CFP-23)
- `docs/product/prd.md#NFR-10` - mutation testing on domain and application (CFP-01 to CFP-12)
- `docs/product/prd.md#NFR-11` - harness verified in CI (CFP-13 to CFP-24)

---

## Success Criteria

- [ ] The median PR critical path is at most 8 minutes over the first five PR runs after this row merges (exit criterion of revision 6, read in the phase review).
- [ ] The feature's own PR shows `mutation`, `smoke` and, when the agent changes, `agent-mutation` and `agent-build` running beside the required checks.
