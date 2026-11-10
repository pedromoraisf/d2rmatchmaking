# Fast Proofs Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only `scripts/proofs-preflight.mjs`, `scripts/test/proofs-preflight.test.mjs`, `.claude/skills/d2rmm-phase-runner/SKILL.md`, `tests/acceptance/steps/fast-proofs.steps.ts` and `.specs/` change. `check_proofs.py` and every vendored TLC file stay unchanged.
- Fast mode, which the maintainer chose on 2026-11-09 ("B. Modo rápido no harness"): there is no Verifier round and no mutation run. Task gates, `pnpm check` and a security `review-diff` stay.
- Run every gate through `node scripts/attempt.mjs run --feature fast-proofs --step T<n> -- "<gate>"`, with this worktree as the working directory and nothing outside the quotes.

---

**Design**: none - Medium feature, one script
**Status**: Approved
**Approved**: 2026-11-09 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm lint; pnpm typecheck; pnpm test:harness`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (How to test), ADR 023.

| Code Layer         | Required Test Type          | Coverage Expectation                      | Location Pattern                              | Run Command                                           |
| ------------------ | --------------------------- | ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Preflight script   | unit (node:test)            | FPR-01 to FPR-06, in a temporary git repo | `scripts/test/proofs-preflight.test.mjs`      | `node --test scripts/test/proofs-preflight.test.mjs`  |
| The runner's guide | acceptance (playwright-bdd) | The scenario of `acceptance.feature`      | `tests/acceptance/steps/fast-proofs.steps.ts` | `pnpm exec turbo run test:acceptance -- --grep @FPR-` |

## Gate Check Commands

| Gate Level | When to Use         | Command                                                                      |
| ---------- | ------------------- | ---------------------------------------------------------------------------- |
| Quick      | T1                  | `node --test scripts/test/proofs-preflight.test.mjs`                         |
| Full       | T2                  | `pnpm exec turbo run test:acceptance -- --grep @FPR-07 && pnpm test:harness` |
| Build      | After the last task | `pnpm lint; pnpm typecheck; pnpm test:harness`                               |

---

## Execution Plan

### Phase 1: The preflight and the guide

```
T1 → T3 → T2
```

---

## Task Breakdown

### T1: The preflight script

**What**: `scripts/proofs-preflight.mjs <feature>`, an ESM Node script with no dependency beyond Node's standard library and `git`:

- It reads `.specs/features/<feature>/tasks.md` `## Checks` and parses each `**C<n>**` line and the `Proof:` command after it, the way `check_proofs.py` does (`CHECK_RE`, `PROOF_RE`).
- It finds the phase from `.specs/phases/ACTIVE`. The changed files are those `git diff --name-only phase/<F>...HEAD` lists, plus those `git status --porcelain` lists (staged, unstaged, untracked).
- For each proof, the key is the SHA-256 of the command plus each changed path and its content, sorted by path. A deleted file contributes its path with empty content.
- A proof whose key is recorded green in `reports/proofs-cache/<feature>.json` is printed as `cached` and not run. Every other proof runs from the repository root with `sh -c`, and its exit code and seconds are printed with `ran`. A green run is recorded under its key.
- It exits 0 only when every proof is green, ran or cached. Otherwise it prints the failing check IDs and exits 1.
- A missing or unreadable cache, or a git failure, makes every proof run. It never fails for that reason alone.

Export the pure parts (`parseChecks`, `proofKey`) for the unit test. Run `main` only when the file is executed directly.
**Where**: `scripts/proofs-preflight.mjs` (new), `scripts/test/proofs-preflight.test.mjs` (new)
**Depends on**: None
**Reuses**: the git-in-a-temporary-repo pattern of `.claude/hooks/test/guard.test.mjs` (`fixture()`). Clear every `GIT_*` variable in the child environment: a leaked `GIT_DIR` once set `core.bare` on the real repository.
**Requirement**: FPR-01, FPR-02, FPR-03, FPR-04, FPR-05, FPR-06

**Done when**:

- [x] A test named `preflight runs each proof once, then caches it` sets up a temporary git repository with `phase/F0`, a feature branch with one changed file, and a `tasks.md` with two checks whose proofs append to a log file. It shows:
  - the first run runs both proofs and prints `ran`;
  - the second runs neither and prints `cached`;
  - after an edit to the changed file, both run again.
- [x] A test named `a failed proof runs again and fails the preflight` shows that a proof exiting 1 makes the preflight exit 1 with its check ID printed, and that the proof runs again on the next call with the same key.
- [x] A test named `a missing cache or a git error runs every proof` covers a deleted cache file, a corrupt one, and a `phase/F0` that does not exist: each makes every proof run, and the preflight still exits 0 when the proofs pass.
- [x] A test named `the key changes with the command and with a changed file's path or content` covers `proofKey` as a pure function.
- [x] The gate passes.

**Tests**: unit
**Gate**: `node --test scripts/test/proofs-preflight.test.mjs`

**Commit**: `feat(harness): cache green proofs in a preflight`

---

### T3: The wrapper accepts step `fix`

**What**: `allowedSteps` in `scripts/lib/steps.mjs` also accepts `fix`. `FIXED_STEPS` in `budget.mjs` stays unchanged, because `trailers.mjs` already adds `fix` for commit trailers. A run with `--step fix` counts under its own unit `gate:<f>/fix`, with the usual 1 attempt + 2 retries. If `attempt.mjs`'s usage message lists the steps, it names `fix` too. This task runs before T2, whose guide names this step. It runs after `phase/F0`, with `budget-v2`, is merged into this branch.
**Where**: `scripts/lib/steps.mjs` (modify), `scripts/test/attempt-cli.test.mjs` (new test), `scripts/attempt.mjs` (usage text only, if it lists the steps)
**Depends on**: T1
**Reuses**: the CLI harness of `attempt-cli.test.mjs`
**Requirement**: FPR-09

**Done when**:

- [x] A test named `the wrapper accepts step fix and counts it on its own unit` runs `attempt.mjs run --feature f --step fix -- "<a passing command>"` and sees exit 0 and a unit `gate:f/fix` in the ledger. A failing command counts on `gate:f/fix` and not on `gate:f/proofs`.
- [x] An unknown step (`--step nope`) is still refused.
- [x] Every existing test of `attempt-cli.test.mjs` passes unchanged.
- [x] The gate passes.

**Tests**: unit
**Gate**: `node --test scripts/test/attempt-cli.test.mjs`

**Commit**: `feat(harness): accept step fix in the attempt wrapper`

---

### T2: The runner's guide uses the preflight

**What**: In `.claude/skills/d2rmm-phase-runner/SKILL.md` § 6 Verify, the fix loop runs `node scripts/attempt.mjs run --feature <f> --step fix -- "node scripts/proofs-preflight.mjs <f>"`. `check_proofs.py` (with `--mutations` when the feature runs mutations) runs as step `proofs` once, when the preflight is green, and runs a second time only if that run fails. Add the steps of the scenario "The runner's guide puts the preflight in the fix loop" to `tests/acceptance/steps/fast-proofs.steps.ts`. They are black-box steps that read the file, in the style of `tests/acceptance/steps/ci-fast-path.steps.ts`.
**Where**: `.claude/skills/d2rmm-phase-runner/SKILL.md` (modify § 6 only), `tests/acceptance/steps/fast-proofs.steps.ts` (new)
**Depends on**: T3
**Reuses**: the file-reading steps of `ci-fast-path.steps.ts`
**Requirement**: FPR-07, FPR-08

**Done when**:

- [ ] § 6 says what the What says, and nothing else in the skill changes.
- [ ] The `@FPR-07` scenario passes.
- [ ] `pnpm test:harness` passes with no test removed or skipped.
- [ ] The gate passes.

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @FPR-07 && pnpm test:harness`

**Commit**: `docs(harness): run the preflight in the fix loop`

---

## Checks

**C1** - The preflight runs each proof, caches green ones under the command and the changed files, reruns a changed or failed one, exits on the result, and runs everything when the cache or git fails (FPR-01, FPR-02, FPR-03, FPR-04, FPR-05, FPR-06)
Proof: `node --test scripts/test/proofs-preflight.test.mjs`

**C2** - The runner's guide puts the preflight in the fix loop and runs the official proofs once (FPR-07)
Proof: `pnpm exec turbo run test:acceptance -- --grep @FPR-07`

**C3** - The harness suite passes with nothing removed or skipped (FPR-08)
Proof: `pnpm test:harness`

**C4** - The wrapper accepts step `fix` and counts it on its own unit (FPR-09)
Proof: `node --test --test-name-pattern "the wrapper accepts step fix" scripts/test/attempt-cli.test.mjs`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:**

- T1 `5c349e6` (5 of 5). T2 stopped because the wrapper refuses `--step fix`: `fix` is a trailer step only. The spec was amended with FPR-09 (AD-174), and T3 adds the step before T2.
- Design choices T1 made, for the phase review:
  - the cache folder is left out of the key;
  - only `## Checks` is read;
  - a feature with no proof exits 1;
  - a failed run drops that key's green entry;
  - a `tasks.md` edit changes the keys, because it is a changed file.

**Dispatched:** execute-batch-1 (T1, T2) to `feature-worker`, returned with T2 stopped. execute-batch-2 (T3, T2) after `phase/F0`, with `budget-v2`, is merged in.
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 → T3 → T2
```

Batches: `execute-batch-1` runs T1 (and stopped at T2); `execute-batch-2` runs T3, then T2.
