# Retry budget — 1 attempt + 2 retries, enforced by code

Decision: ADR 022. Constant: `MAX_RETRIES = 2` in `scripts/lib/budget.mjs` (the only place the number lives; changing
it is a maintainer decision and the gate hook asks for any edit under `.claude/hooks/` or to that file's tests).

**Rule.** Every unit of agentic work gets its first attempt plus at most **2 retries**. On the third failure the unit
is **blocked**: the hooks refuse any further attempt, by any route, until the maintainer resets it. A blocked unit
blocks its feature; the runner records it and moves on to features that do not depend on it.

## Units and how each is enforced

| Unit     | Key                                                                                                                                                                                                                                     | What counts as a failure                                                      | Counting                                                                       | Enforced by                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Gate     | `gate:<feature>/<step>` — step = a task id from `tasks.md` (`T3`) or `spec`, `design`, `tasks`, `proofs`, `verification`, `integration`                                                                                                 | the gate command exits non-zero                                               | cumulative over the unit's life (a pass in between does not refill the budget) | `scripts/attempt.mjs run` — the 4th attempt never executes the command (exit 3)                         |
| Dispatch | `dispatch:<feature>/<step>` — step from a closed list (`feature`, `spec`, `design`, `tasks`, `execute`, `execute-batch-1..9`, `verify`, `verify-r2`, `screens`, `review-spec`, `review-architecture`, `review-security`, `review-diff`) | every dispatch of the same key (a step that succeeded is never re-dispatched) | 3 dispatches allowed; the 4th is refused and blocks                            | PreToolUse gate on `Agent`/`Task`; prompt must start with `[d2rmm feature=<f> step=<s>]`                |
| Stop     | `stop:<session>`                                                                                                                                                                                                                        | ending a turn with red sensors                                                | consecutive (green clears)                                                     | Stop/SubagentStop hook blocks the stop twice; the third red stop ends the turn and exhausts the session |
| Feedback | `feedback:<session>/<file>:<sensor>`                                                                                                                                                                                                    | the same sensor failing on the same file after an edit                        | consecutive (green clears)                                                     | PostToolUse hook; the third failure exhausts the session                                                |
| Denial   | `denial:<session>/<rule>`                                                                                                                                                                                                               | the gate hook denying the same thing again                                    | cumulative per session                                                         | PreToolUse gate; the third identical denial exhausts the session                                        |

**Exhausted session**: the agent may only read, record the blocker in `.specs/` and report back. Bash is limited to
read-only commands and `attempt.mjs status|report`; edits outside `.specs/`, commits and dispatches are denied.
Sessions are per subagent (`session_id#agent_id`), so parallel workers never share or drain each other's budget.

## No open drains — the bypasses and what closes them

| Bypass an agent could try                                             | Closed by                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run tests/gates directly until green, then once through the wrapper   | On `phase/F*` and `feat/F*-*` branches during an approved run, the gate denies vitest, jest, playwright, cargo test/nextest/clippy/mutants, turbo/pnpm test/check/lint/typecheck/arch, tsc, eslint, depcruise, stryker and the TLC validators unless the command goes through `scripts/attempt.mjs run` |
| Chain extra commands after the wrapper (`… -- pnpm test && rm …`)     | Wrapped commands must be a single shell segment; the gate command after `--` is quoted                                                                                                                                                                                                                  |
| Commit without a passing gate                                         | `git commit` on a feature branch needs a passing gate attempt recorded **after** the last commit, and no blocked unit in the feature                                                                                                                                                                    |
| Invent a new step name (`T3b`, `execute-batch-1b`) for a fresh budget | Gate steps must be task ids declared in `tasks.md` or fixed steps; dispatch steps come from a closed list; features must exist and be listed in the brief                                                                                                                                               |
| Switch subagent type for the same step                                | The dispatch key excludes the subagent type                                                                                                                                                                                                                                                             |
| Edit or delete the ledger                                             | It lives in `.git/d2rmm/ledger.json` (shared by all worktrees, never committed); edits under `.git/`, shell commands mentioning it and the `D2RMM_LEDGER` override are denied                                                                                                                           |
| Reset the budget                                                      | `attempt.mjs reset` always asks the maintainer, and every reset is kept in `ledger.resets` for the review                                                                                                                                                                                               |
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

Subagent prompt header (first line): `[d2rmm feature=agent-skeleton step=execute-batch-1]`.
