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
T10 → T11 → T12 → T13 → T14
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

- [ ] `node scripts/attempt.mjs status && node scripts/attempt.mjs reset --unit gate:x/T1 --by maintainer` asks; `echo scripts/attempt.mjs status; node scripts/attempt.mjs reset … --by orchestrator …` asks for a second orchestrator reset; `bash -c "… reset …"` behind a status call asks (test `asks for a reset hidden behind another wrapper call`)
- [ ] Every existing test of `budget-rules.test.mjs` passes unchanged
- [ ] Gate passes

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

- [ ] The BUD-18 filter forms with `2>&1` get no decision (test `allows read-only filters after 2>&1`)
- [ ] `echo x > .claude/hooks/gate.mjs` and `cat a 2>&1 > eslint.config.mjs` still ask (test `still asks for a real write after 2>&1`)
- [ ] Every existing test under `.claude/hooks/test/` passes
- [ ] Gate passes

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

- [ ] The five cases above (test `isUnchangedRerun refuses only the same failing state`)
- [ ] Gate passes

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

- [ ] `--timeout=0` and `--timeout=1.5` exit 2; `--timeout=2` runs (test `reads the timeout in both forms`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test --test-name-pattern "timeout" scripts/test/attempt-cli.test.mjs`

**Commit**: `fix(harness): read the timeout in both forms`

---

## Checks

**C1** - Each signature is matched exactly, and a test-failure marker wins (BUD-01, BUD-26)
Proof: `node --test scripts/test/env-signatures.test.mjs`

**C2** - The ledger records environment failures uncounted, blocks three in a row as `env-blocked`, keeps refusals and append-only resets, and reports them apart (BUD-02, BUD-04, BUD-05, BUD-11, BUD-12, BUD-14, BUD-16, BUD-21)
Proof: `node --test scripts/test/budget.test.mjs`

**C3** - The wrapper classifies, times out at a whole-minute timeout with exit 124, and diagnoses the machine (BUD-03, BUD-04, BUD-06, BUD-27)
Proof: `node --test --test-name-pattern "Docker failure|killed command|stops a command at its timeout|bad timeout|timeout in both forms|diagnoses the machine|diagnosis probe" scripts/test/attempt-cli.test.mjs`

**C4** - The wrapper refuses an unchanged rerun with exit 4 and runs after a change, another command or a machine failure (BUD-08, BUD-09, BUD-10, BUD-28)
Proof: `node --test --test-name-pattern "rerun|empty commit|runs after a change|runs again after a machine failure|without a fingerprint|fingerprint before" scripts/test/attempt-cli.test.mjs`

**C5** - The wrapper keeps the full output and prints its last 60 lines (BUD-17)
Proof: `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`

**C6** - The orchestrator resets a unit once, with a reason, under one key normalisation (BUD-12, BUD-13, BUD-14, BUD-29)
Proof: `node --test --test-name-pattern "reset|needs a reason|unit option" scripts/test/attempt-cli.test.mjs`

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

---

## Phase Execution Map

```
Phase 1:  T1 → T2
Phase 2:  T2 → T3 → T4 → T5 → T6
Phase 3:  T6 → T7 → T8
Phase 4:  T8 → T9 → T10
Phase 5:  T10 → T11 → T12 → T13 → T14
```

Batches: `execute-batch-1` runs phases 1 and 2 (T1 to T6); `execute-batch-2` runs phases 3 and 4 (T7 to T10); `execute-batch-4` runs phase 5 (T11 to T14), the Verifier's findings.
