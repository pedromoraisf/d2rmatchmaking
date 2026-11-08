# Budget v2 Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- `budget-v2` is covered by `harness-self` (brief `## Delegation`): edits of `scripts/attempt.mjs`, `scripts/lib/budget.mjs`, `.claude/hooks/**` and their tests are allowed in this worktree only. Use the Edit and Write tools for them, never a shell write. If an edit is refused, stop and report.
- `MAX_RETRIES` stays 2 (BUD-21). No unit kind of ADR 022 is added or removed; `env-blocked` is a status, not a kind.
- Rules are pure functions over a plain ledger and injected probes (`git`, `clock`, `spawn`, `probe`), unit-tested with fakes. `attempt.mjs` only wires them.
- A ledger written before this feature still loads: attempts without `kind`, `fingerprint` or `command`, and resets without `reason`, read as today's.
- Steps whose text already exists in another acceptance steps file (for example "the agent asks the gate to run …") are reused, never defined again: playwright-bdd refuses duplicate step texts.
- The diagnosis probes (BUD-04) each run at most 10 seconds and print `unavailable` when they fail or time out.
- Every gate runs through `node scripts/attempt.mjs run --feature budget-v2 --step T<n> -- "<gate>"`, from the worktree, with nothing outside the quotes. That is the worktree's own wrapper, which this feature changes: a change that breaks the wrapper shows in its own gate. Keep the `run` interface and the ledger format readable by the main checkout's hooks at every commit.

---

**Design**: none - Medium feature; the placement is fixed in the rules above and in each task
**Status**: Approved
**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm lint; pnpm typecheck; pnpm test:harness`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (How to test, rules 3, 4, 11 and 12), `docs/engineering/testing.md`.

| Code Layer                         | Required Test Type                   | Coverage Expectation                                                                 | Location Pattern                                          | Run Command                                            |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| Signatures, ledger rules (pure)    | unit (`node --test`)                 | BUD-01 to BUD-05, BUD-11 to BUD-16, BUD-21, BUD-26                                   | `scripts/test/env-signatures.test.mjs`, `budget.test.mjs` | `node --test scripts/test/<file>.test.mjs`             |
| The wrapper CLI                    | unit (`node --test`, temporary repo) | BUD-03, BUD-04, BUD-06, BUD-08 to BUD-10, BUD-12 to BUD-14, BUD-17, BUD-27 to BUD-29 | `scripts/test/attempt-cli.test.mjs`                       | `node --test scripts/test/attempt-cli.test.mjs`        |
| Gate and Stop rules (pure)         | unit (`node --test`, fake contexts)  | BUD-07, BUD-15, BUD-18 to BUD-20                                                     | `.claude/hooks/test/budget-rules.test.mjs`                | `node --test .claude/hooks/test/budget-rules.test.mjs` |
| Guides                             | unit (`node --test`, reads files)    | BUD-22, BUD-23                                                                       | `scripts/test/retry-budget-docs.test.mjs`                 | `node --test scripts/test/retry-budget-docs.test.mjs`  |
| The wrapper and hooks as processes | acceptance (playwright-bdd)          | Every scenario of `acceptance.feature`                                               | `tests/acceptance/steps/budget-v2.steps.ts`               | `pnpm exec turbo run test:acceptance -- --grep @BUD-`  |

## Gate Check Commands

| Gate Level | When to Use         | Command                                               |
| ---------- | ------------------- | ----------------------------------------------------- |
| Quick      | Unit tasks          | the task's `node --test` command                      |
| Full       | The acceptance task | `pnpm exec turbo run test:acceptance -- --grep @BUD-` |
| Build      | After the last task | `pnpm lint; pnpm typecheck; pnpm test:harness`        |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: What counts

```
T1 → T2
```

### Phase 2: The wrapper

```
T2 → T3 → T4 → T5 → T6
```

### Phase 3: The gate and the Stop hook

```
T6 → T7 → T8
```

### Phase 4: Guides and scenarios

```
T8 → T9 → T10
```

---

## Task Breakdown

### T1: One list of environment signatures

**What**: `scripts/lib/env-signatures.mjs` exports `classify({ status, signal, output, timedOut })` returning `{ signature }` (one of `docker`, `disk`, `killed`, `port`, `not-found`, `timeout`) or `null`, with the exact matches of BUD-01, and `null` whenever the output shows a test-failure marker of BUD-02 (AD-156).
**Where**: `scripts/lib/env-signatures.mjs`
**Depends on**: None
**Reuses**: none
**Requirement**: BUD-01, BUD-26

**Done when**:

- [ ] One case per signature and per match form (tests `classifies the Docker daemon`, `classifies a full disk`, `classifies a kill`, `classifies a port in use`, `classifies a missing command`, `classifies the wrapper timeout`)
- [ ] A plain `exit 127` with no output is `not-found` (test `classifies a bare exit 127 as not found`)
- [ ] `Module not found`, `404 not found` and an ordinary assertion failure are not environmental (test `leaves ordinary failures alone`)
- [ ] Any signature with a test-failure marker is not environmental (test `a test-failure marker wins over a signature`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/env-signatures.test.mjs`

**Commit**: `feat(harness): name the failures the machine causes`

---

### T2: The ledger knows environment failures, refusals and resets

**What**: in `budget.mjs`: `recordAttempt` takes `kind: 'env'` with `signature` and does not count it; three consecutive `env` attempts set status `env-blocked`; `canAttempt` refuses `env-blocked`; `featureBlocked` and `sessionExhausted` treat `env-blocked` as blocked; `recordRefusal(ledger, key, at)` keeps refused reruns in `ledger.refusals`; `reset` appends `{ key, by, reason, at, previous }` and never removes earlier resets; `orchestratorResets(ledger, key)` counts them; `report` adds columns for environment failures and refused reruns and a resets table with unit, by, reason and time. `MAX_RETRIES` stays 2.
**Where**: `scripts/lib/budget.mjs`
**Depends on**: T1
**Reuses**: `recordAttempt`, `reset`, `report`, `mergeLedgers`
**Requirement**: BUD-02, BUD-04, BUD-05, BUD-11, BUD-12, BUD-14, BUD-16, BUD-21

**Done when**:

- [ ] An environment attempt is recorded with its signature and not counted (test `records an environment failure without counting it`)
- [ ] Three in a row set `env-blocked`; a counted failure or a pass in between restarts the count (tests `three environment failures in a row block the unit`, `a counted failure restarts the environment count`)
- [ ] `env-blocked` blocks the feature (test `an env-blocked unit blocks its feature`)
- [ ] Refusals are kept apart from attempts (test `keeps refused reruns apart`)
- [ ] Resets are append-only and orchestrator resets are counted across later resets (test `keeps every reset and counts the orchestrator's`)
- [ ] The report shows the new columns and the resets with their reasons (test `reports machine failures, refusals and resets apart`)
- [ ] `MAX_RETRIES` is 2 (test `keeps one attempt and two retries`)
- [ ] An old ledger still loads and counts (test `reads a ledger written before budget v2`)
- [ ] Gate passes; every existing test of the file passes

**Tests**: unit
**Gate**: `node --test scripts/test/budget.test.mjs`

**Commit**: `feat(harness): keep environment failures, refusals and resets in the ledger`

---

### T3: The wrapper classifies, times out and diagnoses

**What**: `attempt.mjs run` takes `--timeout <minutes>` (whole number ≥ 1, default 60; anything else exits 2 before running); kills the command at the timeout and classifies it as `timeout` with exit 124; classifies every failure with T1 and records environment failures with T2, printing that it was not counted and the signature; exits with the command's status (124 for a timeout, 137 for a kill by `SIGKILL`); on the run that makes a unit `env-blocked` and on every refused run of such a unit, prints the diagnosis (free memory, swap used, load average, running containers, leftover acceptance processes), each probe bounded to 10 seconds.
**Where**: `scripts/attempt.mjs`
**Depends on**: T2
**Reuses**: T1's `classify`, T2's ledger functions
**Requirement**: BUD-02, BUD-03, BUD-04, BUD-06, BUD-27

**Done when**:

- [ ] A Docker failure is not counted and names `docker` (test `does not count a Docker failure`)
- [ ] A command killed by `SIGKILL` exits 137 and is not counted (test `does not count a killed command`)
- [ ] A command past `--timeout 1` is stopped, exits 124 and is not counted (test `stops a command at its timeout`, with the clock injected)
- [ ] `--timeout 0`, `0.5` and `soon` exit 2 without running (test `refuses a bad timeout`)
- [ ] The third environment failure blocks the unit and prints the diagnosis; a fourth run exits 3 and prints it again (test `diagnoses the machine when it blocks a unit`)
- [ ] Gate passes; every existing test of the file passes

**Tests**: unit
**Gate**: `node --test scripts/test/attempt-cli.test.mjs`

**Commit**: `feat(harness): stop counting the machine's failures`

---

### T4: The wrapper refuses an unchanged rerun

**What**: before running, `attempt.mjs run` computes the fingerprint (`git add -A` into a temporary index with `GIT_INDEX_FILE`, then `git write-tree`; `null` when git fails) and records it with the command on the attempt; when the unit's latest counted failure since its last pass or reset has the same fingerprint and command, it records a refusal with T2, exits 4 and says nothing changed since the last failure, without running; a `null` fingerprint never refuses.
**Where**: `scripts/attempt.mjs`
**Depends on**: T3
**Reuses**: T2's `recordRefusal`
**Requirement**: BUD-08, BUD-09, BUD-10, BUD-11, BUD-28

**Done when**:

- [ ] An unchanged rerun exits 4 without running and keeps the count (test `refuses a rerun with nothing changed`)
- [ ] A counted failure, an environment failure, then the same tree: refused (test `refuses a rerun of a state already proven failing`)
- [ ] An empty commit changes nothing: refused (test `an empty commit is not a change`)
- [ ] An edited or added file, or another command, runs (test `runs after a change or with another command`)
- [ ] After a machine failure alone, the same tree runs (test `runs again after a machine failure`)
- [ ] Outside a git repository nothing is refused (test `never refuses without a fingerprint`)
- [ ] The fingerprint is taken before the command runs (test `takes the fingerprint before the command`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/attempt-cli.test.mjs`

**Commit**: `feat(harness): refuse a rerun with nothing changed`

---

### T5: The wrapper keeps the full output and shows its end

**What**: after a run, `attempt.mjs` writes stdout and stderr to `reports/attempts/<unit>/<n>.log` (`:` and `/` in the unit key become `-`, `<n>` the attempt number) and prints the result, the duration and the last 60 lines (all lines when 60 or fewer).
**Where**: `scripts/attempt.mjs`
**Depends on**: T4
**Reuses**: `tail`
**Requirement**: BUD-17

**Done when**:

- [ ] 60, 61 and 200 lines: the log holds them all and the terminal shows lines 1, 2 and 141 onwards (test `keeps the full output and prints the last 60 lines`)
- [ ] The result and the duration are printed (test `prints the result and the duration`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/attempt-cli.test.mjs`

**Commit**: `feat(harness): write each gate's full output to a log`

---

### T6: The orchestrator resets a unit once

**What**: `attempt.mjs reset` accepts `--unit <key>` and `--unit=<key>` (trimmed), `--by` and `--reason`; `--by orchestrator` needs a non-empty reason and is refused with exit 2 when T2's `orchestratorResets` is already 1 or more, saying the next reset is the maintainer's; every reset appends to `ledger.resets`. The key normalisation is exported for the gate (T7).
**Where**: `scripts/attempt.mjs`
**Depends on**: T5
**Reuses**: T2's `reset`, `orchestratorResets`
**Requirement**: BUD-12, BUD-13, BUD-14, BUD-29

**Done when**:

- [ ] A first orchestrator reset with a reason clears the unit and is kept with its reason (test `resets a unit once for the orchestrator`)
- [ ] A missing reason exits 2 (test `needs a reason from the orchestrator`)
- [ ] A second orchestrator reset exits 2, also after a maintainer reset in between (test `refuses the orchestrator's second reset`)
- [ ] An `env-blocked` unit takes the orchestrator's reset (test `resets an env-blocked unit`)
- [ ] `--unit=<key>` and `--unit <key>` name the same unit (test `reads both forms of the unit option`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/attempt-cli.test.mjs`

**Commit**: `feat(harness): let the orchestrator reset a unit once`

---

### T7: The gate allows the orchestrator's reset, read-only filters, and hands over the command

**What**: in `budget-rules.mjs`: a reset command parsed with T6's normalisation gets no ask when `--by orchestrator` comes with a reason and the unit has no orchestrator reset, and `ask` otherwise (missing `--by` or reason, unparsable, unreadable ledger, a second reset); the wrapper followed by the BUD-18 grammar is not denied, anything else after it is (BUD-19); every wrapper denial and every direct-sensor denial carries the corrected command of BUD-20 (feature from the worktree path, step from the call or `<step>`).
**Where**: `.claude/hooks/lib/budget-rules.mjs`
**Depends on**: T6
**Reuses**: `WRAPPER`, `segments`, `runsSensor`, the worktree detection
**Requirement**: BUD-15, BUD-18, BUD-19, BUD-20

**Done when**:

- [ ] The five reset cases of the scenarios get their decisions (test `asks only for the maintainer's resets`)
- [ ] The three allowed filters pass and the seven other tails are denied (tests `allows read-only filters after the wrapper`, `denies anything else after the wrapper`)
- [ ] Each denial carries the corrected command with the feature and step of BUD-20 (test `hands over the corrected command`)
- [ ] Gate passes; every existing test of the file passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `feat(harness): make the wrapper easy to call`

---

### T8: A red stop caused by the machine is not counted

**What**: `onStop` takes the failing checks one by one; when every one is classified environmental by T1, it lets the agent stop, does not count the red stop, and says which signatures matched; otherwise it counts as today. `stop.mjs` passes each failing check's output and exit status separately.
**Where**: `.claude/hooks/lib/budget-rules.mjs`, `.claude/hooks/stop.mjs`
**Depends on**: T7
**Reuses**: T1's `classify`, `onStop`
**Requirement**: BUD-07

**Done when**:

- [ ] Every check environmental: stop allowed, not counted, signatures named (test `lets the agent stop when the machine failed`)
- [ ] One real failure among them: counted and blocked as today (test `counts a red stop with a real failure`)
- [ ] Gate passes; every existing test of the file passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `feat(harness): do not count a red stop the machine caused`

---

### T9: The guides say what the budget counts

**What**: `AGENTS.md` rule 11 and `references/retry-budget.md` describe what BUD-22 and BUD-23 name; a new `scripts/test/retry-budget-docs.test.mjs` asserts each statement.
**Where**: `AGENTS.md`, `.claude/skills/d2rmm-phase-runner/references/retry-budget.md`
**Depends on**: T8
**Reuses**: ADR 028 § 4 wording
**Requirement**: BUD-22, BUD-23

**Done when**:

- [ ] Rule 11 states both counting changes and the reset rule (test `rule 11 says what the budget counts`)
- [ ] The reference covers signatures, `env-blocked`, exit 4, the orchestrator reset, the logs and the filters (test `the reference describes budget v2`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/retry-budget-docs.test.mjs`

**Commit**: `docs(harness): describe what the retry budget counts`

---

### T10: Scenarios

**What**: `tests/acceptance/steps/budget-v2.steps.ts`: the steps of every scenario of `acceptance.feature`, running `scripts/attempt.mjs`, `.claude/hooks/gate.mjs` and `.claude/hooks/stop.mjs` of this checkout as child processes against a temporary repository (and a temporary non-git directory for BUD-28), with commands that print fixed outputs, exit with fixed codes or kill themselves. Black box: no import of `scripts/lib` or `.claude/hooks/lib`.
**Where**: `tests/acceptance/steps/budget-v2.steps.ts`
**Depends on**: T9
**Reuses**: `harness-bootstrap.steps.ts` (temporary repositories, the gate step)
**Requirement**: BUD-02, BUD-03, BUD-04, BUD-05, BUD-06, BUD-07, BUD-08, BUD-09, BUD-10, BUD-11, BUD-12, BUD-13, BUD-14, BUD-15, BUD-16, BUD-17, BUD-18, BUD-19, BUD-20, BUD-22, BUD-23, BUD-24, BUD-25, BUD-26, BUD-27, BUD-28, BUD-29

**Done when**:

- [ ] Every scenario of `acceptance.feature` passes
- [ ] `pnpm test:harness` and `pnpm contracts:check` pass with no test removed or skipped
- [ ] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @BUD- && pnpm test:harness && pnpm contracts:check`

**Commit**: `test(harness): acceptance steps for budget v2`

---

## Checks

**C1** - Each signature is matched exactly, and a test-failure marker wins (BUD-01, BUD-26)
Proof: `node --test scripts/test/env-signatures.test.mjs`

**C2** - The ledger records environment failures uncounted, blocks three in a row as `env-blocked`, keeps refusals and append-only resets, and reports them apart (BUD-02, BUD-04, BUD-05, BUD-11, BUD-12, BUD-14, BUD-16, BUD-21)
Proof: `node --test scripts/test/budget.test.mjs`

**C3** - The wrapper classifies, times out at a whole-minute timeout with exit 124, and diagnoses the machine (BUD-03, BUD-04, BUD-06, BUD-27)
Proof: `node --test --test-name-pattern "Docker failure" scripts/test/attempt-cli.test.mjs`

**C4** - The wrapper refuses an unchanged rerun with exit 4 and runs after a change, another command or a machine failure (BUD-08, BUD-09, BUD-10, BUD-28)
Proof: `node --test --test-name-pattern "rerun" scripts/test/attempt-cli.test.mjs`

**C5** - The wrapper keeps the full output and prints its last 60 lines (BUD-17)
Proof: `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`

**C6** - The orchestrator resets a unit once, with a reason, under one key normalisation (BUD-12, BUD-13, BUD-14, BUD-29)
Proof: `node --test --test-name-pattern "reset" scripts/test/attempt-cli.test.mjs`

**C7** - The gate asks only for the maintainer's resets, allows read-only filters and hands over the corrected command (BUD-15, BUD-18, BUD-19, BUD-20)
Proof: `node --test .claude/hooks/test/budget-rules.test.mjs`

**C8** - A red stop is uncounted only when the machine caused every failure (BUD-07)
Proof: `node --test --test-name-pattern "red stop" .claude/hooks/test/budget-rules.test.mjs`

**C9** - The guides describe budget v2 (BUD-22, BUD-23)
Proof: `node --test scripts/test/retry-budget-docs.test.mjs`

**C10** - Every scenario of the feature passes (BUD-02 to BUD-20, BUD-22, BUD-23, BUD-26 to BUD-29)
Proof: `pnpm exec turbo run test:acceptance -- --grep @BUD-`

**C11** - The harness suite passes with nothing removed or skipped (BUD-24)
Proof: `pnpm test:harness`

**C12** - No contract drift (BUD-25)
Proof: `pnpm contracts:check`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-1 (T1 to T6) to `feature-worker` at the commit of this note, 2026-11-08
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 → T2
Phase 2:  T2 → T3 → T4 → T5 → T6
Phase 3:  T6 → T7 → T8
Phase 4:  T8 → T9 → T10
```

Batches: `execute-batch-1` runs phases 1 and 2 (T1 to T6); `execute-batch-2` runs phases 3 and 4 (T7 to T10).
