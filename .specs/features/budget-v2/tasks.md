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

### Phase 5: Verifier findings

```
T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17
```

### Phase 6: Bounding forged machine failures

```
T17 → T18 → T19 → T20 → T21 → T22 → T23
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

- [x] One case per signature and per match form (tests `classifies the Docker daemon`, `classifies a full disk`, `classifies a kill`, `classifies a port in use`, `classifies a missing command`, `classifies the wrapper timeout`)
- [x] A plain `exit 127` with no output is `not-found` (test `classifies a bare exit 127 as not found`)
- [x] `Module not found`, `404 not found` and an ordinary assertion failure are not environmental (test `leaves ordinary failures alone`)
- [x] Any signature with a test-failure marker is not environmental (test `a test-failure marker wins over a signature`)
- [x] Gate passes

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

- [x] An environment attempt is recorded with its signature and not counted (test `records an environment failure without counting it`)
- [x] Three in a row set `env-blocked`; a counted failure or a pass in between restarts the count (tests `three environment failures in a row block the unit`, `a counted failure restarts the environment count`)
- [x] `env-blocked` blocks the feature (test `an env-blocked unit blocks its feature`)
- [x] Refusals are kept apart from attempts (test `keeps refused reruns apart`)
- [x] Resets are append-only and orchestrator resets are counted across later resets (test `keeps every reset and counts the orchestrator's`)
- [x] The report shows the new columns and the resets with their reasons (test `reports machine failures, refusals and resets apart`)
- [x] `MAX_RETRIES` is 2 (test `keeps one attempt and two retries`)
- [x] An old ledger still loads and counts (test `reads a ledger written before budget v2`)
- [x] Gate passes; every existing test of the file passes

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

- [x] A Docker failure is not counted and names `docker` (test `does not count a Docker failure`)
- [x] A command killed by `SIGKILL` exits 137 and is not counted (test `does not count a killed command`)
- [x] A command past `--timeout 1` is stopped, exits 124 and is not counted (test `stops a command at its timeout`, with the clock injected)
- [x] `--timeout 0`, `0.5` and `soon` exit 2 without running (test `refuses a bad timeout`)
- [x] The third environment failure blocks the unit and prints the diagnosis; a fourth run exits 3 and prints it again (test `diagnoses the machine when it blocks a unit`)
- [x] Gate passes; every existing test of the file passes

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

- [x] An unchanged rerun exits 4 without running and keeps the count (test `refuses a rerun with nothing changed`)
- [x] A counted failure, an environment failure, then the same tree: refused (test `refuses a rerun of a state already proven failing`)
- [x] An empty commit changes nothing: refused (test `an empty commit is not a change`)
- [x] An edited or added file, or another command, runs (test `runs after a change or with another command`)
- [x] After a machine failure alone, the same tree runs (test `runs again after a machine failure`)
- [x] Outside a git repository nothing is refused (test `never refuses without a fingerprint`)
- [x] The fingerprint is taken before the command runs (test `takes the fingerprint before the command`)
- [x] Gate passes

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

- [x] 60, 61 and 200 lines: the log holds them all and the terminal shows lines 1, 2 and 141 onwards (test `keeps the full output and prints the last 60 lines`)
- [x] The result and the duration are printed (test `prints the result and the duration`)
- [x] Gate passes

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

- [x] A first orchestrator reset with a reason clears the unit and is kept with its reason (test `resets a unit once for the orchestrator`)
- [x] A missing reason exits 2 (test `needs a reason from the orchestrator`)
- [x] A second orchestrator reset exits 2, also after a maintainer reset in between (test `refuses the orchestrator's second reset`)
- [x] An `env-blocked` unit takes the orchestrator's reset (test `resets an env-blocked unit`)
- [x] `--unit=<key>` and `--unit <key>` name the same unit (test `reads both forms of the unit option`)
- [x] Gate passes

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

- [x] The five reset cases of the scenarios get their decisions (test `asks only for the maintainer's resets`)
- [x] The three allowed filters pass and the seven other tails are denied (tests `allows read-only filters after the wrapper`, `denies anything else after the wrapper`)
- [x] Each denial carries the corrected command with the feature and step of BUD-20 (test `hands over the corrected command`)
- [x] Gate passes; every existing test of the file passes

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

- [x] Every check environmental: stop allowed, not counted, signatures named (test `lets the agent stop when the machine failed`)
- [x] One real failure among them: counted and blocked as today (test `counts a red stop with a real failure`)
- [x] Gate passes; every existing test of the file passes

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

- [x] Rule 11 states both counting changes and the reset rule (test `rule 11 says what the budget counts`)
- [x] The reference covers signatures, `env-blocked`, exit 4, the orchestrator reset, the logs and the filters (test `the reference describes budget v2`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/retry-budget-docs.test.mjs`

**Commit**: `docs(harness): describe what the retry budget counts`

---

### T10: Scenarios

**What**: `tests/acceptance/steps/budget-v2.steps.ts`: the steps of every scenario of `acceptance.feature`, running `scripts/attempt.mjs`, `.claude/hooks/gate.mjs` and `.claude/hooks/stop.mjs` of this checkout as child processes against a temporary repository (and a temporary non-git directory for BUD-28), with commands that print fixed outputs, exit with fixed codes or kill themselves. Black box: no import of `scripts/lib` or `.claude/hooks/lib`. The gate steps whose text already exists in `harness-bootstrap.steps.ts` ("the agent asks the gate to run …", "the gate answers …", "the reason names …") are reused, not redefined: move the state they read (the temporary repository and the last decision) into `tests/acceptance/support/gate-world.ts`, have `harness-bootstrap.steps.ts` read and write it there with no change to any of its assertions, and have this feature's Background set it. The `--timeout 1` scenario raises its own test timeout (`testInfo.setTimeout`) above its minute. The untagged `After(async ({ world }) => …)` of `tests/acceptance/steps/observability.steps.ts` starts the whole stack and resets its API for every scenario of the suite, so a budget-v2 scenario fails with `fetch failed` / `ECONNRESET` when that connection drops (3rd T10 run): scope it to the scenarios it serves, `After({ tags: '@NFR-09' }, …)` (every observability-e2e and room-trace-link scenario carries `@NFR-09`), with no other change to that file.
**Where**: `tests/acceptance/steps/budget-v2.steps.ts`, `tests/acceptance/support/gate-world.ts`, `tests/acceptance/steps/observability.steps.ts` (the `After` hook's tag only)
**Depends on**: T9
**Reuses**: `harness-bootstrap.steps.ts` (temporary repositories, the gate step)
**Requirement**: BUD-02, BUD-03, BUD-04, BUD-05, BUD-06, BUD-07, BUD-08, BUD-09, BUD-10, BUD-11, BUD-12, BUD-13, BUD-14, BUD-15, BUD-16, BUD-17, BUD-18, BUD-19, BUD-20, BUD-22, BUD-23, BUD-24, BUD-25, BUD-26, BUD-27, BUD-28, BUD-29

**Done when**:

- [x] Every scenario of `acceptance.feature` passes
- [x] `pnpm test:harness` and `pnpm contracts:check` pass with no test removed or skipped
- [x] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @BUD- && pnpm test:harness && pnpm contracts:check`

**Commit**: `test(harness): acceptance steps for budget v2`

---

### T11: A reset hidden behind another wrapper call still asks

**What**: In `.claude/hooks/lib/budget-rules.mjs`, the reset rule reads every `scripts/attempt.mjs reset` in the line (each segment and each inner shell text), not the first `scripts/attempt.mjs <word>`: a maintainer reset anywhere in the line asks, and an orchestrator reset that would be the second asks, whatever precedes it (Verifier finding 1).
**Where**: `.claude/hooks/lib/budget-rules.mjs` (modify)
**Depends on**: T10
**Reuses**: `WRAPPER_ANY`, the reset checks of T5
**Requirement**: BUD-14, BUD-15

**Done when**:

- [x] `node scripts/attempt.mjs status && node scripts/attempt.mjs reset --unit gate:x/T1 --by maintainer` asks; `echo scripts/attempt.mjs status; node scripts/attempt.mjs reset … --by orchestrator …` asks for a second orchestrator reset; `bash -c "… reset …"` behind a status call asks (test `asks for a reset hidden behind another wrapper call`)
- [x] Every existing test of `budget-rules.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `fix(harness): ask for every reset in a command line`

---

### T12: A descriptor redirection is not a shell write

**What**: In `.claude/hooks/lib/gate-rules.mjs`, the shell-write rule for harness files takes out the four whole tokens `2>&1`, `>/dev/null`, `2>/dev/null` and `&>/dev/null` before it looks for `>`, so `<wrapper> 2>&1 | tail -n N` and `2>&1 | grep …` no longer ask (BUD-18; Verifier finding 2). `budget-rules.test.mjs` asserts these filter forms get no decision at all, instead of only no deny.
**Where**: `.claude/hooks/lib/gate-rules.mjs` (modify)
**Depends on**: T11
**Reuses**: the shell-write rule
**Requirement**: BUD-18

**Done when**:

- [x] The BUD-18 filter forms with `2>&1` get no decision (test `allows read-only filters after 2>&1`)
- [x] `echo x > .claude/hooks/gate.mjs` and `cat a 2>&1 > eslint.config.mjs` still ask (test `still asks for a real write after 2>&1`)
- [x] Every existing test under `.claude/hooks/test/` passes
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs .claude/hooks/test/gate-rules.test.mjs`

**Commit**: `fix(harness): a descriptor redirection is not a shell write`

---

### T13: Unit tests of the unchanged-rerun rule

**What**: `scripts/test/budget.test.mjs` gains pure tests of `isUnchangedRerun` (Verifier finding 4): refused for the same command and fingerprint after a counted failure; not refused with a null fingerprint, after an environment failure in between, after a pass in between, or for a different command.
**Where**: `scripts/test/budget.test.mjs` (modify)
**Depends on**: T12
**Reuses**: `isUnchangedRerun` of `scripts/lib/budget.mjs`
**Requirement**: BUD-09, BUD-10

**Done when**:

- [x] The five cases above (test `isUnchangedRerun refuses only the same failing state`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/budget.test.mjs`

**Commit**: `test(harness): prove the unchanged-rerun rule on its own`

---

### T14: The `--timeout=<n>` form

**What**: `scripts/attempt.mjs` reads `--timeout=<n>` as `--timeout <n>`, so `--timeout=0` and `--timeout=1.5` are refused with exit 2 and `--timeout=2` sets two minutes (Verifier finding 5).
**Where**: `scripts/attempt.mjs` (modify)
**Depends on**: T13
**Reuses**: the timeout parsing of T3
**Requirement**: BUD-27

**Done when**:

- [x] `--timeout=0` and `--timeout=1.5` exit 2; `--timeout=2` runs (test `reads the timeout in both forms`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test --test-name-pattern "timeout" scripts/test/attempt-cli.test.mjs`

**Commit**: `fix(harness): read the timeout in both forms`

---

### T15: A covered branch that does not exist touches nothing

**What**: In `.claude/hooks/lib/guard.mjs`, `touches(ctx, state, ref, branch)` returns `false` when the covered `branch` does not resolve to a commit (a covered feature not started yet), so `git worktree add <path> -b feat/F0-<feature> phase/F0` and `git branch feat/F0-<feature> phase/F0` are no longer denied as bringing that branch in. A `ref` that does not resolve keeps today's decision (the guard still fails closed on it), and a covered branch that exists is judged as today.
**Where**: `.claude/hooks/lib/guard.mjs` (modify)
**Depends on**: T14
**Reuses**: `touches`, `revList`, `commitOf`
**Requirement**: none in the spec — a guard defect found during the run (it denied creating `feat/F0-continuous-delivery`); added with the maintainer's approval on 2026-11-08 ("Sobre a worktree, crie por mim. eu aprovo sua execução"), under `harness-self`

**Done when**:

- [x] With a covered feature whose branch does not exist, `git worktree add .claude/worktrees/x -b feat/F0-x phase/F0` and `git branch feat/F0-x phase/F0` get no guard decision (test `a covered branch not started touches nothing`)
- [x] A covered branch that exists and holds commits beyond the phase is still found by a merge or a branch operand naming it; an unresolvable operand still denies (test `still guards a covered branch that exists`)
- [x] Every existing test of `guard.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/guard.test.mjs`

**Commit**: `fix(harness): a covered branch not started touches nothing`

---

### T16: The guard sees a covered branch on the remote too

**What**: In `.claude/hooks/lib/guard.mjs`, a covered branch counts as not started only when neither `<branch>` nor `origin/<branch>` resolves; otherwise `touches` and `proofOf` use whichever head resolves (the local one first), as `judgeGhMerge` already does. The "git cannot answer" arm (the phase branch does not resolve) keeps failing closed (Verifier round 2, findings 1, 3 and 4).
**Where**: `.claude/hooks/lib/guard.mjs` (modify)
**Depends on**: T15
**Reuses**: `touches`, `proofOf`, `commitOf`, `judgeGhMerge`
**Requirement**: none in the spec — the T15 guard fix (maintainer-approved 2026-11-08)

**Done when**:

- [x] With a covered branch that exists only as `origin/<branch>` and holds a commit beyond the phase, `git merge --no-ff origin/<branch>`, `git merge refs/remotes/origin/<branch>`, `git pull origin <branch>`, `gh pr merge <branch> --merge` and `git cherry-pick origin/<branch>` are denied (test `guards a covered branch that exists only on the remote`)
- [x] When the phase branch does not resolve, a covered branch that does not exist still touches every operand (test `fails closed when git cannot answer`)
- [x] A merge of a branch with its own commit, sharing none with the covered branch, is not judged as touching it (test `touches only through a shared commit`)
- [x] Every existing test of `guard.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/guard.test.mjs`

**Commit**: `fix(harness): guard a covered branch that exists only on the remote`

---

### T17: A reset is found however the wrapper is spelled

**What**: In `.claude/hooks/lib/budget-rules.mjs`, `WRAPPER_ANY` matches `attempt.mjs` with an optional quote around it and any directory prefix (or none, after a `cd scripts`), so `node "scripts/attempt.mjs" reset …` and `cd scripts && node attempt.mjs reset …` are judged as resets (Verifier round 2, finding 2).
**Where**: `.claude/hooks/lib/budget-rules.mjs` (modify)
**Depends on**: T16
**Reuses**: `WRAPPER_ANY`, the reset rule of T11
**Requirement**: BUD-14, BUD-15

**Done when**:

- [x] `node "scripts/attempt.mjs" reset --unit gate:x/T1 --by maintainer`, `node 'scripts/attempt.mjs' reset …` and `cd scripts && node attempt.mjs reset … --by maintainer` ask (test `finds a reset however the wrapper is spelled`)
- [x] Every existing test of `budget-rules.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `fix(harness): find a reset however the wrapper is spelled`

---

### T18: A fourth machine failure in total blocks the unit

**What**: In `scripts/lib/budget.mjs`, `recordAttempt` marks a unit `env-blocked` when its environment failures since its last pass or reset reach `ENV_TOTAL_TO_BLOCK = 4`, next to the existing three-in-a-row rule (`ENV_ATTEMPTS_TO_BLOCK`); a pass or a reset starts that total again. The diagnosis printed when the third in a row blocks a unit is printed when the fourth in total does (BUD-30, AD-167). Superseded by T23 (AD-172): only a reset starts the total again; a pass does not.
**Where**: `scripts/lib/budget.mjs` (modify)
**Depends on**: T17
**Reuses**: `trailingEnvRun`, `isEnvFailure`, `recordAttempt`, `reset`
**Requirement**: BUD-30

**Done when**:

- [x] env, env, counted, env, env → `env-blocked`; env, env, counted, env → `open`; env, env, pass, env, env → `open`; four env failures with a reset after the second → `open` (test `blocks at the fourth machine failure in total`)
- [x] The assertion of `a counted failure restarts the environment count` (`budget.test.mjs`, written by this feature's T3 at `2583309`) for env, env, counted, env, env becomes `env-blocked`, as BUD-30 requires: the maintainer's option (b) changes that outcome, and the change is stricter, not looser; its env, env, counted, env case stays `open`. Every other existing test of `budget.test.mjs` and `attempt-cli.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/budget.test.mjs scripts/test/attempt-cli.test.mjs`

**Commit**: `fix(harness): block a unit at its fourth machine failure in total`

---

### T19: At most two uncounted red stops per session

**What**: In `.claude/hooks/lib/budget-rules.mjs`, `onStop` records each red stop it leaves uncounted under BUD-07 in the ledger under the session id; when two are already recorded for that session, or the input has no session id, the red stop counts as an ordinary one with today's rules (BUD-31, AD-167; AD-155 unchanged).
**Where**: `.claude/hooks/lib/budget-rules.mjs` (modify)
**Depends on**: T18
**Reuses**: `onStop`, the red-stop counting of T8
**Requirement**: BUD-31

**Done when**:

- [x] Two machine-caused red stops of one session stay uncounted; the third counts; another session's first stays uncounted; a red stop with no session id counts (test `leaves at most two red stops uncounted per session`)
- [x] `red stop: lets the agent stop when the machine failed` (`budget-rules.test.mjs`, written by this feature's T8 at `e5b8dd0`) loops four red stops in one session expecting none counted; BUD-31 makes the third and fourth count, so it asserts the first two uncounted and the third and fourth counted — stricter, not looser. Every other existing test of `budget-rules.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `fix(harness): count a session's third machine-caused red stop`

---

### T20: The new scenario runs

**What**: Run the `@BUD-30` scenario ("Four machine failures in all block the unit…") and the whole `@BUD-` suite with the steps of `tests/acceptance/steps/budget-v2.steps.ts`; add a step only if a line of the new scenario has none (none is expected: it reuses the lines of "A counted failure between machine failures starts the count again").
**Where**: `tests/acceptance/steps/budget-v2.steps.ts` (only if a step is missing)
**Depends on**: T19
**Reuses**: the T10 steps
**Requirement**: BUD-30

**Done when**:

- [x] Every scenario of `acceptance.feature` passes, the `@BUD-30` one included
- [x] The harness suite passes with no test removed or skipped
- [x] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @BUD- && pnpm test:harness`

**Commit**: `test(harness): run the budget-v2 total-failures scenario`

---

### T21: A merge of ledgers keeps both bounds

**What**: In `scripts/lib/budget.mjs`, `mergeLedgers` keeps every `(sid, seq)` of `uncountedStops` once and, per session, the larger count of either side; for a unit it keeps the larger environment-failure total since the last pass or reset of either side, so a merge can neither give a session its uncounted stops back nor lower a unit's BUD-30 total (Verifier round 3, finding 1 and the non-blocking merge note). Superseded by T23 (AD-172): only a reset starts the total again; a pass does not.
**Where**: `scripts/lib/budget.mjs` (modify)
**Depends on**: T20
**Reuses**: `mergeLedgers`, the BUD-30 total of T18, the `uncountedStops` field of T19
**Requirement**: BUD-30, BUD-31

**Done when**:

- [x] Two ledgers holding uncounted stops of one session merge to the larger count, each `(sid, seq)` once; returning `uncountedStops: []` from the merge turns the test red (test `a merge keeps the uncounted stops`)
- [x] `[env, env, counted, env]` merged with `[counted, counted]` keeps the environment total 3 (test `a merge keeps the larger environment total`)
- [x] Every existing test of `budget.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/budget.test.mjs`

**Commit**: `fix(harness): a ledger merge keeps both budget bounds`

---

### T22: A subagent of an unknown session counts its red stops

**What**: `.claude/hooks/test/budget-rules.test.mjs` gains a test that `onStop` counts the first red stop of `unknown-session#agent-1` (a subagent of an input with no `session_id`), as it does for the bare `unknown-session` (Verifier round 3, finding 2). No code change unless the test shows a defect.
**Where**: `.claude/hooks/test/budget-rules.test.mjs` (modify)
**Depends on**: T21
**Reuses**: the red-stop tests of T19
**Requirement**: BUD-31

**Done when**:

- [x] The first red stop of `unknown-session#agent-1` counts; mutating the check to `String(sid) !== 'unknown-session'` turns it red (test `a subagent of an unknown session counts its red stops`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `test(harness): count red stops of an unknown session's subagents`

---

### T23: Only a reset clears the machine-failure total

**What**: In `scripts/lib/budget.mjs`, the BUD-30 total counts every environment failure in the unit's attempts (which a reset empties), whatever passed between them; a pass no longer ends the count and no longer clears `envCarried`; only a reset does (AD-172). `mergeLedgers` keeps the larger total across a pass. T18's own test case "env, env, pass, env, env → `open`" (written by this feature at `ea401bc`) becomes `env-blocked`, as the amended BUD-30 requires (stricter); T21's merge test keeps its expectations or tightens the same way. The "A pass between machine failures does not start the total again" scenario runs with the existing steps.
**Where**: `scripts/lib/budget.mjs` (modify)
**Depends on**: T22
**Reuses**: `envTotalSincePass`, `envCarried`, `mergeLedgers`, `recordAttempt`
**Requirement**: BUD-30

**Done when**:

- [x] env, env, pass, env, env → `env-blocked`; four env failures with a reset after the second → `open`; `envCarried` survives a pass and is cleared by a reset (test `only a reset clears the machine-failure total`)
- [x] T18's pass case in `blocks at the fourth machine failure in total` expects `env-blocked`; every other existing test of `budget.test.mjs` and `attempt-cli.test.mjs` passes unchanged
- [ ] Every scenario of `acceptance.feature` passes, the two `@BUD-30` ones included (the gate ran the `@BUD-30` scenarios only, as its command states; the full `@BUD-` set is not run by this task)
- [x] Gate passes

**Tests**: unit and acceptance
**Gate**: `node --test scripts/test/budget.test.mjs scripts/test/attempt-cli.test.mjs && pnpm exec turbo run test:acceptance -- --grep @BUD-30`

**Commit**: `fix(harness): only a reset clears the machine-failure total`

---

### T24: A reset is found through quotes, escapes, case and hidden code

**What**: The third `review-diff` (2026-11-09) found that `node scripts/att''empt.mjs reset --unit gate:f/T1 --by maintainer`, `attempt\.mjs` and `"attempt".mjs` get no decision from the gate (an allow, so a reset without the maintainer's prompt). In `.claude/hooks/lib/budget-rules.mjs` a reset is judged — through `resetDecision`, which keeps judging the raw text, so such a spelling is never the plain orchestrator form and asks — when any of these holds:
(a) `WRAPPER_ANY`, made case-insensitive (the macOS file system is), finds `reset` in the command line or in any command it hides (`innerShellCommands`), each read with every `'`, `"` and `\` removed;
(b) a shell segment of the line, or of a hidden command, runs a program whose path holds an expansion or a glob (`$`, a backtick, `*`, `?`, `[`) and has the word `reset` among its arguments;
(c) inline interpreter code (`node -e`, `python -c`, a heredoc) or an untracked script the line runs names, once quotes, `+`, `\` and whitespace are removed, `attempt.mjs`, `budget.mjs` or `ledger-store.mjs` (case-insensitive) — this is an `ask`, since such code can call the reset without the wrapper (a copy or a link of `scripts/attempt.mjs` is caught here, as its text imports `./lib/budget.mjs`). Put (c) where the gate already reads inline code and untracked scripts (`checkInlineCode` in `gate-rules.mjs`) if it cannot be reached from `budget-rules.mjs`; keep that change to one added condition.
A gate run whose own command mentions "reset" (`node scripts/attempt.mjs run --feature f --step T1 -- "node --test --test-name-pattern reset x.test.mjs"`) and `node scripts/attempt.mjs status` keep getting no decision; the plain first orchestrator reset keeps getting none.
**Where**: `.claude/hooks/lib/budget-rules.mjs` (modify), `.claude/hooks/lib/gate-rules.mjs` (only for (c), if needed), `.claude/hooks/test/budget-rules.test.mjs` (new cases)
**Depends on**: T23
**Reuses**: `WRAPPER_ANY`, `resetDecision`, `innerShellCommands`, `segments`, `checkInlineCode`
**Requirement**: BUD-14, BUD-15

**Done when**:

- [x] A test named `a reset is judged through quotes, escapes, case and hidden code` asks for each of: `node scripts/att''empt.mjs reset --unit gate:f/T1 --by maintainer`; `node scripts/attempt\.mjs reset …`; `node scripts/"attempt".mjs reset …`; `node scripts/ATTEMPT.mjs reset …`; `bash -c "node scripts/att''empt.mjs reset --unit gate:f/T1 --by maintainer"`; `node scripts/att${x}empt.mjs reset …`; `node scripts/att*.mjs reset …`; `node -e "import('./scripts/att'+'empt.mjs')"`; an untracked `scripts/x.mjs` whose text imports `./lib/budget.mjs`, run as `node scripts/x.mjs reset …`
- [x] The same test gets no decision for the plain first orchestrator reset with a reason, `node scripts/attempt.mjs status`, and the gate run above whose command mentions "reset"
- [x] Every existing test of `budget-rules.test.mjs` and `gate-rules.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs .claude/hooks/test/gate-rules.test.mjs`

**Commit**: `fix(harness): find a reset through quotes, escapes, case and hidden code`

---

### T25: The guard reads both the local and the remote head

**What**: The third `review-diff` found that `headOf` in `.claude/hooks/lib/guard.mjs` takes the local branch when it exists and `origin/<branch>` only when it does not. With `feat/F0-x` local at the phase head and `origin/feat/F0-x` holding gate-touching commits, `git merge origin/feat/F0-x` computes no shared commit, demands no proof and lets the change in. Change it so:

- `touches`: the covered commits are the union of those beyond the phase branch on the local branch and on `origin/<branch>`, each read when it resolves. When neither resolves and the phase branch resolves, the covered branch still touches nothing (T15). When any list fails, it still fails closed (true).
- `proofOf`: when both heads resolve and differ, the covered head is the one that contains the other, and proof is demanded at that head. When neither contains the other, the merge is denied with a reason that names both heads and says to push or fetch until they agree. When only one resolves, behaviour is unchanged.
  **Where**: `.claude/hooks/lib/guard.mjs` (modify), `.claude/hooks/test/guard.test.mjs` (new cases)
  **Depends on**: T24
  **Reuses**: `headOf`, `revList`, `touches`, `proofOf`, `isSubsetOfProven`, the fake git of `guard.test.mjs`
  **Requirement**: none in the spec. This is a fix to the T15/T16 guard change, which the maintainer approved on 2026-11-08, under `harness-self`.

**Done when**:

- [x] A test named `the guard reads both the local and the remote head` covers four cases:
  - Local at the phase head and origin ahead with a gate-touching commit: `git merge origin/feat/F0-x` is denied for missing proof at the origin head.
  - Local ahead of origin: proof is demanded at the local head.
  - Local and origin diverged: the merge is denied, and the reason names both heads.
  - Proof at the larger head: the merge is allowed.
- [x] The existing tests "a covered branch not started touches nothing", "exists only on the remote", "git cannot answer" and "only through a shared commit" pass unchanged, and so does every other test of `guard.test.mjs`.
- [x] The gate passes.

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/guard.test.mjs`

**Commit**: `fix(harness): guard the union of the local and remote heads`

---

### T26: A reset is found when the word itself is hidden

**What**: Verifier round 5 (finding 1, blocking) found that the subcommand word can be hidden, and the reset then gets no decision: `node scripts/attempt.mjs "$(echo reset)" --unit k --by maintainer`, `node scripts/attempt.mjs $r …`, `x=reset; node scripts/attempt.mjs $x …` and `node scripts/a{t,t}empt.mjs reset …`. In `.claude/hooks/lib/budget-rules.mjs`:
(a) a wrapper call found in a line or a hidden command, read with quotes and backslashes removed (T24), is a possible reset when its first word after the file name is `reset` (case-insensitive) or holds `$`, a backtick or `{`. `WRAPPER_ANY` captures that word as `\S+` instead of `\w+`. Any other word is not a reset, and neither is a call with no word after the file name. So `git add scripts/attempt.mjs scripts/lib/budget.mjs` and `attempt.mjs status;` get no decision.
(b) `EXPANDS` gains `{`. Rule (b) of T24 holds when one of these expands or globs:

- the program itself;
- the first operand, when the segment's head after `NAME=value` words and runners is an interpreter (`node`, `python[\d.]*`, `bun`, `tsx`, `deno`, `sh`, `bash`, `zsh`), because that first operand is the script it runs.
  It also needs `reset` among the arguments, or an argument that holds `$`, a backtick or `{`.
  Replan, 2026-11-09: the first wording read the first operand of every program. That made `… | grep $(rm -rf apps)` ask instead of deny, and broke `denies anything else after the wrapper`.
  In `checkInlineCode` (`gate-rules.mjs`), inline code or an untracked script asks when it calls `import(` or `require(` with anything but one plain string literal (finding 2: `import('./scripts/'+a+'.mjs')`, `import(['att','empt'].join(''))`). This is one added condition next to T24's.
  **Where**: `.claude/hooks/lib/budget-rules.mjs` (modify), `.claude/hooks/lib/gate-rules.mjs` (one condition), `.claude/hooks/test/budget-rules.test.mjs` and `.claude/hooks/test/gate-rules.test.mjs` (new cases)
  **Depends on**: T25
  **Reuses**: `WRAPPER_ANY`, `BARE`, `EXPANDS`, `mayReset`, `checkInlineCode`, T24's test
  **Requirement**: BUD-14, BUD-15

**Done when**:

- [x] A test named `a reset is judged when the word itself is hidden` asks for each of these four lines: the three wrapper calls with an expanded word, and the brace spelling above.
  - The same test asks for `node scripts/a{t,t}empt.mjs $x --unit k --by maintainer`.
  - It gets no decision for `node scripts/attempt.mjs run --feature f --step T1 -- "x"`, `node scripts/attempt.mjs status`, `node scripts/attempt.mjs report` and `node scripts/att*.mjs status`.
- [x] The T24 test gains cases that pin rule (b) (finding 3). Each is a line that no other rule asks on, and the worker checks by reading the decision's reason that rule (b) is the one asking:
  - a program path with `?`, one with `[`, and one with a backtick, each followed by `reset`;
  - `FOO=1 node scripts/att*.mjs reset --unit k --by maintainer` asks;
  - `bash -c 'node scripts/att*.mjs reset --unit k --by maintainer'` asks.
- [x] A test in `gate-rules.test.mjs` named `inline code naming the budget modules asks` pins T24's inline-code rule (finding 4). Each of these asks:
  - `node -e "import('./scripts/ATTEMPT.mjs')"`;
  - `node -e "import('./scripts/att' + 'empt.mjs')"` (with spaces);
  - a name split by a backslash;
  - `node -e "import('./scripts/lib/ledger-store.mjs')"`;
  - the two dynamic-import examples of finding 2.
    It gets no decision for `node -e "import('node:fs')"`.
- [x] Every existing test of both files passes unchanged.
- [x] The gate passes.

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs .claude/hooks/test/gate-rules.test.mjs`

**Commit**: `fix(harness): find a reset whose word is hidden`

---

### T27: The guard tests pin one failing range, an origin-only proof and the advice

**What**: Verifier round 5 (finding 5) left three T25 mutations alive. Add cases to `the guard reads both the local and the remote head` in `.claude/hooks/test/guard.test.mjs`:

- Only one of the two commit lists fails, local or origin: the merge fails closed and demands proof.
- A covered branch exists only on origin with a proof at its head: `git merge origin/<branch>` is allowed.
- The diverged deny's reason contains "push or fetch" and the branch name.
  No code changes, unless a case fails. If one fails, the guard is fixed to match T25's What.
  **Where**: `.claude/hooks/test/guard.test.mjs` (new cases)
  **Depends on**: T26
  **Reuses**: the fake git of `guard.test.mjs`, T25's test
  **Requirement**: none in the spec. This is the T15 guard fix, maintainer-approved on 2026-11-08, under `harness-self`.

**Done when**:

- [ ] The three cases above are in the T25 test, and they pass.
- [ ] Every existing test of `guard.test.mjs` passes unchanged.
- [ ] The gate passes.

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/guard.test.mjs`

**Commit**: `test(harness): pin the guard's failing range, origin-only proof and advice`

---

### Phase 7: The third review of the diff

```
T23 → T24 → T25 → T26 → T27
```

---

## Checks

**C1** - Each signature is matched exactly, and a test-failure marker wins (BUD-01, BUD-26)
Proof: `node --test scripts/test/env-signatures.test.mjs`

**C2** - The ledger records environment failures uncounted, blocks three in a row as `env-blocked`, keeps refusals and append-only resets, and reports them apart (BUD-02, BUD-04, BUD-05, BUD-11, BUD-12, BUD-14, BUD-16, BUD-21)
Proof: `node --test scripts/test/budget.test.mjs`

**C3** - The wrapper classifies, times out at a whole-minute timeout with exit 124, and diagnoses the machine (BUD-03, BUD-04, BUD-06, BUD-27)
Proof: `node --test --test-name-pattern "Docker failure" --test-name-pattern "killed command" --test-name-pattern "stops a command at its timeout" --test-name-pattern "bad timeout" --test-name-pattern "timeout in both forms" --test-name-pattern "diagnoses the machine" --test-name-pattern "diagnosis probe" scripts/test/attempt-cli.test.mjs`

**C4** - The wrapper refuses an unchanged rerun with exit 4 and runs after a change, another command or a machine failure (BUD-08, BUD-09, BUD-10, BUD-28)
Proof: `node --test --test-name-pattern "rerun" --test-name-pattern "empty commit" --test-name-pattern "runs after a change" --test-name-pattern "runs again after a machine failure" --test-name-pattern "without a fingerprint" --test-name-pattern "fingerprint before" scripts/test/attempt-cli.test.mjs`

**C5** - The wrapper keeps the full output and prints its last 60 lines (BUD-17)
Proof: `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`

**C6** - The orchestrator resets a unit once, with a reason, under one key normalisation (BUD-12, BUD-13, BUD-14, BUD-29)
Proof: `node --test --test-name-pattern "reset" --test-name-pattern "needs a reason" --test-name-pattern "unit option" scripts/test/attempt-cli.test.mjs`

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

**C13** - The unchanged-rerun rule refuses only the same failing state (BUD-09, BUD-10)
Proof: `node --test --test-name-pattern "isUnchangedRerun" scripts/test/budget.test.mjs`

**C14** - A reset anywhere in a command line is judged, not only the first wrapper call (BUD-14, BUD-15)
Proof: `node --test --test-name-pattern "hidden behind another wrapper call" .claude/hooks/test/budget-rules.test.mjs`

**C15** - A read-only filter after `2>&1` gets no decision; a real write still asks (BUD-18)
Proof: `node --test --test-name-pattern "2>&1" .claude/hooks/test/budget-rules.test.mjs`

**C16** - A covered feature not started yet does not stop its own branch from being created (guard defect, maintainer-approved)
Proof: `node --test --test-name-pattern "a covered branch not started touches nothing" .claude/hooks/test/guard.test.mjs`

**C17** - A covered branch on the remote only is still guarded; git failing still fails closed; touching needs a shared commit (T15 fix, maintainer-approved)
Proof: `node --test --test-name-pattern "exists only on the remote" --test-name-pattern "git cannot answer" --test-name-pattern "only through a shared commit" .claude/hooks/test/guard.test.mjs`

**C18** - A reset is judged however the wrapper is spelled (BUD-14, BUD-15)
Proof: `node --test --test-name-pattern "however the wrapper is spelled" .claude/hooks/test/budget-rules.test.mjs`

**C19** - A fourth machine failure in total blocks the unit; only a reset starts the total again, a pass does not (AD-172) (BUD-30)
Proof: `node --test --test-name-pattern "blocks at the fourth machine failure in total" scripts/test/budget.test.mjs`

**C20** - At most two red stops per session are left uncounted (BUD-31)
Proof: `node --test --test-name-pattern "at most two red stops uncounted per session" .claude/hooks/test/budget-rules.test.mjs`

**C21** - A merge of ledgers keeps the uncounted stops and the larger environment total (BUD-30, BUD-31)
Proof: `node --test --test-name-pattern "a merge keeps the uncounted stops" --test-name-pattern "a merge keeps the larger environment total" scripts/test/budget.test.mjs`

**C22** - A subagent of an unknown session counts its red stops (BUD-31)
Proof: `node --test --test-name-pattern "a subagent of an unknown session counts its red stops" .claude/hooks/test/budget-rules.test.mjs`

**C23** - Only a reset clears the machine-failure total; a pass does not (BUD-30, AD-172)
Proof: `node --test --test-name-pattern "only a reset clears the machine-failure total" scripts/test/budget.test.mjs`

**C24** - A reset is judged through quotes, escapes, case and hidden code (BUD-14, BUD-15)
Proof: `node --test --test-name-pattern "a reset is judged through quotes, escapes, case and hidden code" .claude/hooks/test/budget-rules.test.mjs`

**C25** - The guard reads both the local and the remote head of a covered branch (T15 fix, maintainer-approved)
Proof: `node --test --test-name-pattern "the guard reads both the local and the remote head" .claude/hooks/test/guard.test.mjs`

**C26** - A reset is judged when its word is hidden, and inline code that names or builds a budget module asks (BUD-14, BUD-15)
Proof: `node --test --test-name-pattern "a reset is judged when the word itself is hidden" --test-name-pattern "a reset is judged through quotes, escapes, case and hidden code" .claude/hooks/test/budget-rules.test.mjs && node --test --test-name-pattern "inline code naming the budget modules asks" .claude/hooks/test/gate-rules.test.mjs`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** (1) One example of "Reruns of a state already proven failing are refused" could not happen: BUD-09 refuses the same command on the same tree before it runs, so the environment failure in between comes from another command of the same unit; the row is reworded, the scenario's outcome is unchanged. (2) Accepted batch-1 deviations: `scripts/lib/gate-run.mjs` and `scripts/lib/machine-diagnosis.mjs` hold the injected rules; `timeout` is matched before `killed`; `remainingRetries` is capped at `MAX_RETRIES`; `--timeout` is capped at 35791 minutes; the fingerprint and `clean` exclude `reports/attempts/`; reset reasons are trimmed. Until this branch merges, the main checkout's library counts environment attempts (still `ok: false`) as failures. (3) BUD-18 says the gate "SHALL NOT deny" a read-only filter after the wrapper, and so does its scenario: T7's test asserts that the decision is not `deny`. Through the whole gate the line still gets `ask` today, because the old shell-write rule of `gate-rules.mjs` reads the `>` of `2>&1` as a write to `scripts/attempt.mjs`; that false positive is GPR-07 of `gate-precision`, not this row's. (4) A lone `2>&1` after the wrapper stays allowed, as today; the corrected command strips a leading `cd <dir> &&` and takes the feature from the worktree, else from `--feature`, else `<feature>`.
**Dispatched:** execute-batch-1 (T1 to T6) to `feature-worker` at `9734d9a`, 2026-11-08, returned at `5aad60b` (T1 to T6 committed); execute-batch-2 (T7 to T10) to `feature-worker` at `54f05d0`, 2026-11-08, returned with T7 uncommitted (gate `T7` at 1 of 3 failures: the filter test asserted no opinion, see (3)) after the gate refused a Write to the session scratchpad; execute-batch-2 again (retry 1, T7 to T10) to `feature-worker` at `f6266df`, 2026-11-08, returned at `8bc9276` (T7 to T9 committed; T10 stopped on its plan, see "Batch 2 stop"); T10 replanned: BUD-20's step reads "the agent, working in the worktree of …, asks the gate to run …", the gate steps' state moves to `tests/acceptance/support/gate-world.ts`, and the one-minute scenario raises its timeout; execute-batch-3 (T10) to `feature-worker` at `59d2c39`, 2026-11-08, returned with T10 uncommitted (gate `T10` at 2 of 3 failures, both `Test has unknown parameter "testInfo"` from bddgen; the working tree now asks for `$testInfo`, untested); execute-batch-3 again (retry 1, T10, last gate run) to `feature-worker` at the commit of this note, 2026-11-08
**Walked:** none

**Batch 2 stop (2026-11-08):** T7 `9f7f774`, T8 `e5b8dd0` and T9 `8bc9276` are committed; T10 is not started, because its plan does not hold as written and reusing the named steps needs a change outside its file. (a) BUD-20's line `When the agent asks the gate to run "<command>" in the worktree of "demo"` also matches harness-bootstrap's `^the agent asks the gate to run "(.+)"$`. playwright-bdd reports "Multiple definitions matched scenario step" and bddgen fails for the whole suite, so no budget-v2 step can define that line while the bootstrap pattern stands. A narrower bootstrap pattern (for example `"([^"]*)"`, after its Examples are checked) or a different step would fix it. (b) The reused steps "the agent asks the gate to run …", "the gate answers …" and "the reason names …" read the scenario world that harness-bootstrap keeps under its own key and only its Given sets. The budget-v2 Background does not set that world, so reuse needs it shared through a support module. (c) The `--timeout 1` scenario waits one minute, longer than the suite's 60 s test timeout, so its steps must raise the test timeout. T10's gate has not run. The orchestrator replans T10 and decides (a) and (b) before a new dispatch.

**Batch 3 retry stop (2026-11-08, gate not run):** the T10 code is uncommitted and the Done-when boxes stay unticked. Pre-flight, outside the gate: `bddgen` exits 0 and generates `.features-gen/budget-v2/acceptance.feature.spec.js` with the BUD scenarios, so every step line matches exactly one definition and `$testInfo` is the playwright-bdd 9.2.1 fixture name. The gate was launched twice and refused before it ran, both times with exit 2 and `attempt: unknown feature "budget-v2" (no .specs/features/budget-v2/)`: `scripts/attempt.mjs` reads `process.cwd()` as the repository root, and the shell's working directory resets to the primary checkout (`.claude/worktrees/ci-fast-path`) on every call, so a launch from the worktree needs the `cd … &&` prefix that the brief forbids. `node scripts/attempt.mjs status --feature budget-v2` shows `gate:budget-v2/T10` at 2 of 3 failures, so the last run is unspent. The orchestrator launches `node scripts/attempt.mjs run --feature budget-v2 --step T10 -- "pnpm exec turbo run test:acceptance -- --grep @BUD- && pnpm test:harness && pnpm contracts:check"` with the worktree as the process's working directory, and commits only on a pass.

**Blocked — T10 (2026-11-08):** the orchestrator ran the last attempt from the worktree. 53 of 55 `@BUD-` scenarios passed; BUD-06 (the `--timeout 1` scenario) and BUD-15 Example #4 failed with `TypeError: fetch failed` / `read ECONNRESET`. `gate:budget-v2/T10` used 3 of 3 and is blocked; the T10 code stays uncommitted. Recorded in `.specs/phases/F0/decisions.md` → Blocked. Needs the maintainer's reset or a replan of T10.

**Replan — T10 (2026-11-08):** the maintainer reset `gate:budget-v2/T10`. Cause of the two failures found by the orchestrator: the untagged `After` hook of `observability.steps.ts` asks for the `world` fixture, which starts the stack and calls `stack.reset()` before every scenario, budget-v2's included. T10 now scopes that hook to `@NFR-09`. Next: execute-batch-3 (retry) finishes and commits T10.

**T10 done (2026-11-08):** execute-batch-3 (retry, after the maintainer reset the dispatch) committed `3e3cc97`; gate passed on its first run after the reset: 55 of 55 `@BUD-` scenarios, `pnpm test:harness` 488 pass, `pnpm contracts:check` clean. The blocks above are resolved. Next: proofs.

**Verifier (2026-11-08):** FAIL at `590421a`, 5 findings (one blocking: a reset hidden behind another wrapper call is not judged). Replanned as T11 to T14; checks C3, C4 and C6 widened (finding 3) by this commit. Dispatched: execute-batch-4 (T11 to T14) to `feature-worker` at the commit of this note.

**Round 2 (2026-11-08):** Verifier FAIL at `7276e6f` (4 findings: the remote-only bypass T15 opened, a reset spelled with quotes or after `cd scripts`, two surviving guard mutations). Fixed by T16 `67b2710` and T17 `9196e14`, closed in `110dad0`. `mutations.json`: the two round-2 mutations on the old `guard.mjs:77` line were rewritten for the T16 code; "touches only an unresolved ref" was replaced by "ignores a covered branch on the remote", because `touches` is only called with refs that resolve, so it was equivalent.

**Verified (2026-11-08):** `check_proofs.py --mutations` at `360f81f`: 21 pass, 12 of 12 mutations killed; `validate_verification.py` 0 errors (attempt 3 of 3). Next: integration, then the `security-reviewer` `review-diff` at the integrated head (`harness-self`), then the merge into `phase/F0`.

**Integration and review-diff (2026-11-08):** `pnpm check`, ratchet and contracts green at `ec53b14` (the first `pnpm check` failed on Prettier padding in `spec.md`, fixed by `ec53b14`). `security-reviewer` `review-diff` FAIL: an agent can make its own failures look environmental (`exit 137`, `exit 127`, an echoed signature) and so escape the budget; red stops had no cap. The maintainer chose option (b) ("vai de B"): the spec gains BUD-30 and BUD-31 (`883048f`, spec-reviewer PASS). Dispatched: execute-batch-7 (T18 to T20) to `feature-worker` at the commit of this note. Non-blocking for the phase review: N1 (a covered worktree path can hold another branch name), N2 (`git remote remove` is not judged), N3 (a wrapper spelled with a glob), N4 (a forced file under `reports/attempts`).

**Batch 7 and round 3 (2026-11-08):** T18 `ea401bc`, T19 `a6e8aeb`, T20 `5f24d1c` (every gate on its first run; 56 `@BUD-` scenarios, 501 harness tests). Verifier round 3 FAIL at `674dfda`: 19 of 21 mutations killed; `mergeLedgers` can drop `uncountedStops`, and `unknown-session#agent` is untested. Not blocking: each subagent has its own two uncounted stops (the agent does not choose its session id; dispatches are counted). Replanned as T21 and T22. Dispatched: execute-batch-8 (T21, T22) to `feature-worker` at the commit of this note.

**Round 3 closed and second review-diff (2026-11-09):** T21 `bae7638`, T22 `c06298d`, findings closed `a361dcc`; proofs 25 pass, 21 of 21 mutations killed; verification 0 errors (`647a7af`); `phase/F0` merged in (`a5628b7`), integration green. `security-reviewer` `review-diff` FAIL: a forged pass (`-- "true"`) cleared the BUD-30 total, so env, env, pass cycles bought free runs without end. Spec amended (`2b9220d`, AD-172): only a reset clears the total. Replanned as T23. Dispatched: execute-batch-9 (T23) to `feature-worker` at the commit of this note. Non-blocking for the phase review: N5 (a stale merge can restore a total after a pass: fails safe), N6 (`--by orchestrator` is self-declared: the BUD-12 design), N7 (two uncounted stops per subagent).

**Round 4 and third review-diff (2026-11-09):** T23 `6303f5e`. Verifier round 4: proofs 26 pass, 24 of 24 mutations killed, verification gate passed (`4475b0f`, `89fc6de`). At `89fc6de`, `pnpm check`, the ratchet and contracts are green.

The `security-reviewer` `review-diff` returned FAIL with two findings:

- BLOCKER: the reset check reads the raw text, so `att''empt.mjs`, `attempt\.mjs` and `"attempt".mjs` reset with no prompt. The old regex had the same hole, and the new bounds depend on closing it.
- MAJOR: the guard reads the local head only when it exists, so a stale local branch hides gate-touching commits on `origin/<branch>`.

Replanned as T24 and T25. Dispatched: execute-batch-5 (T24, T25) to `feature-worker` at the commit of this note.

Non-blocking, for the phase review:

- N8: commits that sit only on an uncovered branch name are not seen. This is the limit of branch-based coverage.
- N9: inline code that builds a ledger path by concatenation is a residual of the text gate that predates this feature.

**Phase 7 done and blocked dispatch (2026-11-09):**

- T24 `748d03c` and T25 `b202433` passed their gates on the first run. Proofs at `b202433`: 28 pass, 0 fail (`4f372b3`).
- The worker flagged two things:
  - T24's inline-code `ask` applies outside phase runs and without the word `reset`.
  - The guard test file takes about 130 s.
- **Blocked:** the round-5 Verifier dispatch was refused. `dispatch:budget-v2/verify-r2` has used its three dispatches (rounds 2 to 4).
- The maintainer approved the reset of that unit at the gate's prompt (`--by pedromoraisf`). Dispatched: verify-r2 (round 5) to `verifier` at the commit of this note.

**Verifier round 5 (2026-11-09):** FAIL at `4bd6b05`.

- Proofs: 28 pass. Mutations: 40 killed, 14 not.
- Finding 1 (blocking): a hidden reset word gets no decision, for example `"$(echo reset)"`, `$x` or `a{t,t}empt`.
- Finding 2: inline code that builds the module name at run time is not seen.
- Findings 3 to 5: the surviving mutations come from missing test cases.
- `gate:budget-v2/verification` is blocked at 3 of 3: its failures add up across rounds.
- `gate:budget-v2/proofs` is at 2 of 3.
- Replanned as T26 (findings 1 to 4) and T27 (finding 5).
- Dispatched: execute-batch-5 (T26, T27) to `feature-worker` at the commit of this note.
- After the fixes, the verification gate needs the maintainer's reset.

**Batch 4 (2026-11-08):** T11 `2cc708b`, T12 `9f6c6fe`, T13 `3392cdf`, T14 `72d7cbd`, findings closed `e024dfc`; every gate passed on its first run. T13 follows BUD-09's scenario where the Done-when was loose (an environment failure in between does not clear a refusal of the latest counted state). T11 also asks for a first orchestrator reset chained after another wrapper call. **T15 added (2026-11-08):** the guard defect that stops `continuous-delivery` from starting, with the maintainer's approval. Dispatched: execute-batch-5 (T15) to `feature-worker` at the commit of this note.

**Blocked — T18 plan defect (2026-11-08, gate not run):** T18's Done-when says every existing test of `budget.test.mjs` passes unchanged, but `a counted failure restarts the environment count` asserts `open` for the sequence env, env, counted, env, env (its message: "two environment failures since the counted one"). T18's own first bullet requires `env-blocked` for that same sequence under BUD-30. The new test `blocks at the fourth machine failure in total` fails red as written; with `ENV_TOTAL_TO_BLOCK = 4` the existing assertion fails (1 of 20 in `budget.test.mjs`; `attempt-cli.test.mjs` passes 27 of 27). T19 has the same kind of conflict: `red stop: lets the agent stop when the machine failed` expects four uncounted red stops of one session, which BUD-31 forbids on the third. No attempt was spent: the gate was not run, because it cannot pass as written. The worktree is at `79d63a9`, clean; the attempted change is saved as `t18-attempt.patch` in the implementer's scratchpad. Needs the orchestrator's replan: the two existing assertions must change (or the Done-when must say so), which the implementer may not do.

---

## Phase Execution Map

```
Phase 1:  T1 → T2
Phase 2:  T2 → T3 → T4 → T5 → T6
Phase 3:  T6 → T7 → T8
Phase 4:  T8 → T9 → T10
Phase 5:  T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17
Phase 6:  T17 → T18 → T19 → T20 → T21 → T22 → T23
Phase 7:  T23 → T24 → T25 → T26 → T27
```

Batches: `execute-batch-1` runs phases 1 and 2 (T1 to T6); `execute-batch-2` runs phases 3 and 4 (T7 to T10); `execute-batch-4` runs phase 5 (T11 to T14), the Verifier's findings; `execute-batch-5` runs T15; `execute-batch-6` runs T16 and T17, the round-2 findings; `execute-batch-7` runs phase 6 (T18 to T20), after the security review of the diff; `execute-batch-8` runs T21 and T22, the round-3 findings; `execute-batch-9` runs T23, the second review of the diff; `execute-batch-5` runs phase 7 (T24, T25), the third review of the diff. The model policy names only `execute-batch-1` to `-9`, all used. `execute-batch-5` is reused for phase 7: T24 and T25, then T26 and T27, the round-5 findings. A dispatch unit counts every dispatch, not only failures, so that is its third and last dispatch.
