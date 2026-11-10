# Retry budget — 1 attempt + 2 retries, enforced by code

Decision: ADR 022, changed for what counts by ADR 028 § 4. Constant: `MAX_RETRIES = 2` in `scripts/lib/budget.mjs` (the only place the number lives; changing
it is a maintainer decision and the gate hook asks for any edit under `.claude/hooks/` or to that file's tests).

**Rule.** Every unit of agentic work gets its first attempt plus at most **2 retries**. On the third failure the unit
is **blocked**: the hooks refuse any further attempt, by any route, until the maintainer resets it. A blocked unit
blocks its feature; the runner records it and moves on to features that do not depend on it. Environment failures and
unchanged reruns do not count (see "Budget v2" below).

## Units and how each is enforced

| Unit     | Key                                                                                                                                                                                                                              | What counts as a failure                                                             | Counting                                                                       | Enforced by                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Gate     | `gate:<feature>/<step>` — step = a task id from `tasks.md` (`T3`) or `spec`, `design`, `tasks`, `proofs`, `verification`, `integration`                                                                                          | the gate command exits non-zero and no environment signature matches (BUD-02)        | cumulative over the unit's life (a pass in between does not refill the budget) | `scripts/attempt.mjs run` — the 4th attempt never executes the command (exit 3); an unchanged rerun exits 4 without running |
| Dispatch | `dispatch:<feature>/<step>` — step from a closed list (`execute-batch-1..9`, `verify`, `verify-r2`, `screens`, `review-spec`, `review-architecture`, `review-security`, `review-diff`), each tied to one subagent type (ADR 025) | every dispatch of the same key (a step that succeeded is never re-dispatched)        | 3 dispatches allowed; the 4th is refused and blocks                            | PreToolUse gate on `Agent`/`Task`; prompt must start with `[d2rmm feature=<f> step=<s>]`                                    |
| Stop     | `stop:<session>`                                                                                                                                                                                                                 | ending a turn with red sensors, unless every failing check is environmental (BUD-07) | consecutive (green clears)                                                     | Stop/SubagentStop hook blocks the stop twice; the third red stop ends the turn and exhausts the session                     |
| Feedback | `feedback:<session>/<file>:<sensor>`                                                                                                                                                                                             | the same sensor failing on the same file after an edit                               | consecutive (green clears)                                                     | PostToolUse hook; the third failure exhausts the session                                                                    |
| Denial   | `denial:<session>/<rule>`                                                                                                                                                                                                        | the gate hook denying the same thing again                                           | cumulative per session                                                         | PreToolUse gate; the third identical denial exhausts the session                                                            |

**Exhausted session**: the agent may only read, record the blocker in `.specs/` and report back. Bash is limited to
read-only commands and `attempt.mjs status|report`; edits outside `.specs/`, commits and dispatches are denied.
Sessions are per subagent (`session_id#agent_id`), so parallel workers never share or drain each other's budget.

## Budget v2: what counts (ADR 028 § 4)

**Environment failures do not count.** A gate that fails with an environment signature is recorded as an environment
failure and not counted. The signatures are one list, in `scripts/lib/env-signatures.mjs`:

- `docker`: `Cannot connect to the Docker daemon` or `Could not find a working container runtime strategy`.
- `disk`: `ENOSPC` or `no space left on device`, in any case.
- `killed`: exit status 137 or termination by `SIGKILL`.
- `port`: `EADDRINUSE`.
- `not-found`: exit status 127, a line ending in `: command not found`, or `spawn <name> ENOENT`.
- `timeout`: the wrapper stopped the command at its `--timeout` (exit status 124).

A failure whose output also shows a test-failure marker (`not ok `, `✖`, `✗`, `FAIL`, `failing`, `test result: FAILED`,
or a line matching `Tests?:.*failed`) counts as an ordinary failure: a real test failure never spends nothing, and the
machine problem shows again on the next run if it is real. A test whose output says `Module not found` or
`404 not found` counts, because no signature matches it.

The wrapper exits with the command's status (124 for a timeout, 137 for a kill) and prints that the failure was not
counted and which signature matched. A red Stop hook is not counted when every failing check is environmental; the agent
may stop, and the hook names the signatures. One failing check without a signature counts the red stop as before.

**Three environment failures in a row block the unit as `env-blocked`.** The unit blocks its feature, as a `blocked`
unit does. The wrapper prints a diagnosis of the machine (free memory, swap used, load average, running containers and
leftover acceptance processes) when the third failure blocks the unit, and again on every refused run of it. Each probe
runs at most 10 seconds and prints `unavailable` when it fails. A counted failure or a pass in between starts the
count again. The runner escalates the machine, not the code: a stopped Docker, a full disk or a leftover process is
fixed by the maintainer, and the orchestrator's one reset (below) applies to an `env-blocked` unit too.

**An unchanged rerun is refused with exit 4.** Before a run, the wrapper takes the fingerprint of the working tree (every
file not ignored by git, through a temporary index) and records it with the command. When the unit's latest counted
failure since its last pass or reset has the same fingerprint and the same command, `attempt.mjs run` exits 4 without
running the command, keeps the failure count, and records the refused rerun in `ledger.refusals`. An empty commit changes
nothing. An edited or added file, or another command, runs. Outside a git repository nothing is refused.

**The orchestrator resets a unit once.** `node scripts/attempt.mjs reset --unit <key> --by orchestrator --reason "<why>"`
resets a unit that has no orchestrator reset yet. The reason is required (exit 2 without one). Every reset is appended
to `ledger.resets` with its unit, `by`, reason and time, and no reset is ever removed. A second orchestrator reset of the
same unit, whatever resets came between, exits 2 and is the maintainer's. The gate asks for every other reset: `--by` is
anything else or missing, the reason is missing, the command or the ledger cannot be read, or the unit already has an
orchestrator reset. `attempt.mjs report` lists every reset and, for each unit, its environment failures and refused
reruns in columns of their own.

**Logs and the end of the output.** Each run writes its full stdout and stderr to `reports/attempts/<unit>/<n>.log`, with
`:` and `/` in the unit key replaced by `-` and `<n>` the attempt number (for example `reports/attempts/gate-demo-T1/1.log`).
The terminal shows the result, the duration and the last 60 lines. Read the rest of a log with `tail`, `head` or `grep`.
`--timeout <minutes>` takes a whole number from 1 (default 60); any other value exits 2 without running the command.

**Exit codes of `run`.** The command's own status when it ran (124 for a timeout, 137 for a kill); 3 when the unit is
blocked or `env-blocked`; 4 for an unchanged rerun, refused; 2 for invalid usage.

**Filters after the wrapper.** The gate allows the wrapper, then an optional `2>&1`, then exactly one read-only filter:
`| tail -n <N>`, `| head -n <N>`, or `| grep` with the options `-i`, `-E`, `-v`, `-c`, `-n` and one pattern (a single-quoted
string without `'`, or a plain token of letters, digits and `_.:@/-`). Any other tail is denied: another pipe, `>`, `<`,
`;`, `&&`, `||`, `&`, `$(…)`, a backtick, or a pattern outside that list. The denial carries the corrected command.

## No open drains — the bypasses and what closes them

| Bypass an agent could try                                             | Closed by                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run tests/gates directly until green, then once through the wrapper   | On `phase/F*` and `feat/F*-*` branches during an approved run, the gate denies vitest, jest, playwright, cargo test/nextest/clippy/mutants, turbo/pnpm test/check/lint/typecheck/arch, tsc, eslint, depcruise, stryker and the TLC validators unless the command goes through `scripts/attempt.mjs run` |
| Chain extra commands after the wrapper (`… -- pnpm test && rm …`)     | Wrapped commands must be a single shell segment; the gate command after `--` is quoted                                                                                                                                                                                                                  |
| Commit without a passing gate                                         | `git commit` on a feature branch needs a passing gate attempt recorded **after** the last commit, and no blocked unit in the feature                                                                                                                                                                    |
| Invent a new step name (`T3b`, `execute-batch-1b`) for a fresh budget | Gate steps must be task ids declared in `tasks.md` or fixed steps; dispatch steps come from a closed list; features must exist and be listed in the brief                                                                                                                                               |
| Switch subagent type for the same step                                | The dispatch key excludes the subagent type                                                                                                                                                                                                                                                             |
| Edit or delete the ledger                                             | It lives in `.git/d2rmm/ledger.json` (shared by all worktrees, never committed); edits under `.git/`, shell commands mentioning it and the `D2RMM_LEDGER` override are denied                                                                                                                           |
| Reset the budget                                                      | `attempt.mjs reset` asks the maintainer, except the orchestrator's first reset of a unit with a reason (BUD-15); every reset is kept in `ledger.resets` for the review                                                                                                                                  |
| Corrupt ledger                                                        | Treated as a blocked unit, never as an empty one                                                                                                                                                                                                                                                        |
| Keep looping on Stop                                                  | The stop counter, not `stop_hook_active`, guarantees termination after 2 forced continuations                                                                                                                                                                                                           |
| Keep retrying a denied action                                         | The third identical denial exhausts the session                                                                                                                                                                                                                                                         |
| Weaken the test or the gate instead                                   | Separate gate rules: removing/skipping tests, loosening sensors or the baseline are escalations                                                                                                                                                                                                         |

## What the runner does when a unit blocks

1. Write the blocker in the feature's `tasks.md ## Handoff` (unit key, last error, what was tried in each attempt).
2. Add a row to `.specs/phases/<F>/decisions.md → Blocked` (`node scripts/attempt.mjs status --feature <f>` output).
3. Continue with features that do not depend on it. If every remaining feature depends on it, escalate.
4. The phase review includes `node scripts/attempt.mjs report` (every unit, attempts, failures, last error, resets).

## How to call things during a run

```sh
# a task gate (from tasks.md), a spec gate, the proofs, the final check, integration
node scripts/attempt.mjs run --feature agent-skeleton --step T3 -- "pnpm exec vitest run apps/agent/ui"
node scripts/attempt.mjs run --feature agent-skeleton --step spec -- "python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py agent-skeleton"
node scripts/attempt.mjs run --feature agent-skeleton --step proofs -- "python3 .claude/skills/tlc-spec-driven/scripts/check_proofs.py agent-skeleton"
node scripts/attempt.mjs run --feature agent-skeleton --step integration -- "pnpm check"
```

Subagent prompt header (first line): `[d2rmm feature=agent-skeleton step=execute-batch-1]` (dispatched to `feature-worker`).
