# Phase F0 — Brief revision 3 (proposal)

**Status**: APPLIED to `brief.md` on 2026-11-04. Approved by the maintainer: "aprovo a revisão 3 do brief da F0".
**Why**: the F0 review (`review.md`) found three defects in the harness that stop the phase from collecting its remaining
proofs or that spend budget for nothing. They should be fixed before `phase/F0` is pushed.

When approved, the orchestrator applies the feature row below to `brief.md` and quotes the approval words in the
revision's `**Approved**` line, then runs the feature with `/phase-run F0` and regenerates the review with
`/phase-review F0`. Until then the F0 brief keeps its current features.

## 1. New feature row

| Feature             | Size  | Depends on    | Parallel | Covers                              | Wall-clock |
| ------------------- | ----- | ------------- | -------- | ----------------------------------- | ---------- |
| ci-and-review-fixes | Small | load-baseline | no       | NFR-10, NFR-11, ADR 020/021/023/026 | default    |

No new exit criterion. The feature lets existing criteria 1, 9, 11 and 15 be proven. No product behaviour changes.

## 2. Scope of the feature (sketch for its Specify; the runner writes the requirement IDs)

### Fix 1: acceptance builds the site it needs

- **Problem**: the CI `integration` job runs `pnpm run test:acceptance` with no site build. `@d2rmm/acceptance` does not depend on `@d2rmm/web`, so turbo's `^build` skips the site and the stack stops with `the site is not built`. All 100 scenarios that started failed this way locally on a checkout with no `apps/web/dist`.
- **Change**: in `turbo.json`, `test:acceptance` also depends on `@d2rmm/web#build`. This fixes CI and a fresh local checkout with one line, and adds no dependency or lockfile change.
- **Proof**: a harness test pins the dependency in `turbo.json`; a gate removes `apps/web/dist` and runs one scenario through `pnpm test:acceptance`.

### Fix 2: `mutation.agent.core` can be measured

- **Problem, local**: `cargo mutants --output reports/mutation/agent-core` writes `agent-core/mutants.out/outcomes.json`, and the baseline's `source.path` reads `agent-core/outcomes.json`. The metric stays "not measured" with the file present.
- **Problem, nightly**: `agent-mutation` runs in its own Windows job, and the `quality` job, which runs the ratchet, never downloads the report. Correcting the path alone would not reach the nightly ratchet.
- **Problem, review**: `pnpm test:mutation` covers only the API, so the review has no command that produces this report.
- **Change**: correct `source.path`, with no value or threshold changed; `quality` waits for `agent-mutation` and downloads its artifact; add a `test:mutation:agent` script with the nightly's commands (`--lib` only, ADR 026) and list it in the review step.
- **Proof**: a unit test that a `mutants.out/outcomes.json` fixture yields the score at the configured path; a harness test pins the job order and the artifact download; `pnpm quality:collect` prints a value for `mutation.agent.core`.
- **To decide in Design**: what `quality` does when `agent-mutation` is skipped because the agent did not change.
- **Known effect**: the first `--update` after this sets the value from `null`. At `2801b4b` the score would be 100 (59 caught, 0 missed), with tolerance 2%.

### Fix 3: the review does not re-run a check that cannot pass

- **Problem**: REVIEW step 1 in `d2rmm-phase-runner/SKILL.md` runs `validate_verification.py` per feature on the phase branch. The script requires `proofs.md` to name HEAD exactly, so it always fails after a merge, and each run spends a failure from a unit that already passed.
- **Change**: REVIEW step 1 drops that command and reads the evidence instead: `pnpm phase:status` and `node scripts/attempt.mjs status --feature <f>`. Step 6 of RUN keeps the gate unchanged at the feature's head, before the merge. The TLC script is vendored and stays untouched.
- **Rejected**: re-running `check_proofs.py` at the phase head. It repeats every proof, and committing the result moves HEAD again.
- **Proof**: a harness test that the REVIEW section does not name `validate_verification.py` and that RUN step 6 still does.
- **Your call**: this removes a command from the review, so it is listed here for your decision and not taken under `harness-edits`. The validator's other checks (closed findings, mutation rows, approval lines) then run only before the merge.

## 3. Out of scope (stay as risks in `review.md`)

- `test:e2e` has no task in any workspace (risk 5).
- The API domain mutation margin (risk 6).
- Whether `backup` should need a reviewer, and the backlog of waiting nightly runs (risk 7).
- Telemetry and egress reduction (risk 8).
- The rejection at `support/world.ts:259` and building the headless example in a fresh local checkout (risk 9).
- Whether read-only steps should spend retry budget (risk 10).

## 4. Risks to confirm in Specify

- **The nightly proof depends on an open failure.** Run `41653012528` failed its `quality` job at "Harness report", before the ratchet step, and its log could not be read because the run is still waiting on `backup`. If this failure still exists after the merge, fix 2's nightly half cannot be seen working until it is fixed. It may need a small addition to this scope.
- **The first real proof of fixes 1 and 2 comes after the push.** Local gates prove the changes, but only a GitHub run proves the jobs.

## Approval

<!-- The maintainer writes or dictates this line. The agent never fills it in on its own. -->
