# Nightly report — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-nightly-report` →
`phase/F2`

Rules:

- `.quality-baseline.json`, `ci.yml` and `ocr-real.yml` are not touched.
- No mutation run in a gate (ADR 029). A missed mutant still fails its job.
- Actions are pinned by full SHA, as `nightly-workflow.test.mjs` checks.
- `ocr-protection` owns the core baseline fix and the domain survivors. Do not edit reading modules here.

## Batch 1

- [x] T1 — Write a unit test in the adapters that kills the survivor at `http/sse.rs:60` (`ready_check_open_from_body`
      → `None`) (NGT-09). Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib`
- [x] T2 — Write `scripts/nightly/mutation.mjs` and `merge-mutants.mjs` with unit tests on fixtures cut from run
      44558970584 and from a Stryker report (NGT-04, NGT-10). Gate: `node --test scripts/test/nightly-*.test.mjs`
- [x] T3 — Write `scripts/nightly/load.mjs` and `acceptance.mjs` with unit tests (NGT-05, NGT-06). Gate: as T2
- [x] T4 — Write `scripts/nightly/trend.mjs`, `render.mjs` and the `report.mjs` CLI with unit tests, including "no
      previous report" (NGT-03, NGT-07). Gate: as T2
- [x] T5 — Restructure `nightly.yml` as in design.md (NGT-01, NGT-02, NGT-08). Cover:
  - the `suites` input;
  - the matrices with shards;
  - the acceptance and load jobs;
  - quality merging the shards;
  - the `always()` report job with `actions: read`.

  Update `scripts/test/nightly-workflow.test.mjs` to match. Gate: `pnpm test:harness`

- [x] T6 — Write ADR 035 (Proposed), amend `testing.md` rule 8, and document dispatching a suite on a branch. Add the
      acceptance steps for `@NGT-02` and `@NGT-06`. Gate:
      `pnpm format:check && pnpm specs:check && pnpm exec turbo run test:acceptance -- --grep @NGT-`

## Batch 2 (the orchestrator dispatches the nightly on the branch)

- [ ] T7 — Fix what the dispatched run shows, until a full run on the branch publishes the report and takes 40
      minutes or less. Mutation survivors left in reading modules belong to `ocr-protection`; list them and do not fix
      them. Gate:
      `gh run list --workflow nightly.yml --branch feat/F2-nightly-report --limit 1 --json conclusion,createdAt,updatedAt,url`
