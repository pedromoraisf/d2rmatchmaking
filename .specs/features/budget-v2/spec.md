# Budget v2 Specification

**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

In F0 the retry budget counted failures the agent did not cause and reruns that could not change anything. Docker
stopping, an 8 GB machine running out of memory and a missing binary on PATH spent units; the maintainer sent 34
messages that only reset a budget, and 30 new `/phase-run` sessions started to get past an exhausted one. The wrapper
also produced 182 denials for the way it was called. ADR 028 § 4 (accepted 2026-11-07) keeps `MAX_RETRIES = 2` and
changes what counts. Source: `.specs/phases/F0/brief-revision-6.md` § 3 (budget-v2), approved by the maintainer on
2026-11-07, and AD-140.

## Goals

- [ ] An environment failure and an unchanged rerun leave a unit's failure count as it was.
- [ ] The orchestrator resets a unit once, with a recorded reason; a second reset of that unit asks the maintainer.
- [ ] A gate's full output is on disk and the terminal shows its end; the wrapper can be read through `tail`, `head`
      and `grep`, and every wrapper denial carries the command to run instead.

## Out of Scope

| Feature                                                                  | Reason                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Changing `MAX_RETRIES` or the units of ADR 022                           | ADR 028 § 4 keeps them; brief revision 6 § 7                 |
| The proofs cache and preflight                                           | `fast-proofs`, brief revision 6                              |
| Read-only shell commands outside the wrapper, polling limits, gate speed | `gate-precision`, brief revision 6                           |
| Fixing the machine (Docker, memory, swap) when a unit is `env-blocked`   | An escalation of the machine to the maintainer (ADR 028 § 4) |
| Any product behaviour: API, site, agent or contract changes              | The row changes harness files, their tests and two guides    |
| `.claude/hooks/gate.mjs` and the gate rules outside `budget-rules.mjs`   | The wrapper and reset rules live in `budget-rules.mjs`       |

---

## Assumptions & Open Questions

| Assumption / decision                                    | Chosen default                                                                                                                                                      | Rationale                                                                                                                                                                                     | Confirmed?          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| What "the content of the paths the feature touches" is   | The tree of the whole working directory where the gate runs, tracked and untracked files not ignored by git, as `git write-tree` gives it through a temporary index | One hash that any edit changes, without deciding which paths belong to the feature; stricter than a per-path set, since a change anywhere is needed and nothing outside the tree can fake one | n - AD-153, assumed |
| The wrapper's timeout                                    | `run` takes `--timeout <minutes>`, default 60; a command still running then is killed and recorded as an environment failure                                        | ADR 028 lists "the wrapper's own timeout" among the signatures and the wrapper has none today; 60 minutes is above every F0 gate, including a full acceptance run                             | n - AD-154, assumed |
| A red stop caused by the machine                         | The Stop hook lets the agent stop, does not count it, and says the machine needs attention                                                                          | Blocking the stop without counting it could loop forever; counting it is what ADR 028 § 4 removes                                                                                             | n - AD-155, assumed |
| A signature and a test-failure marker in the same output | The failure counts                                                                                                                                                  | A real test failure must never spend nothing; the machine problem shows again on the next run if it is real                                                                                   | n - AD-156, assumed |
| Who an `env-blocked` unit blocks                         | Its feature, like a blocked unit; the orchestrator's one reset applies to it, and the runner escalates the machine                                                  | ADR 028 § 4: "the runner escalates the machine, not the code"                                                                                                                                 | y - ADR 028 § 4     |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Environment failures do not count ⭐ MVP

**User Story**: As the runner, I want a failure caused by the machine to be recorded without spending the budget so that a stopped Docker does not block a feature.

**Why P1**: most of the 34 reset messages in F0 followed machine failures.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. BUD-01: The environment signatures SHALL be one fixed list in one module, each with a name and an exact match: `docker` (a line containing `Cannot connect to the Docker daemon` or `Could not find a working container runtime strategy`), `disk` (`ENOSPC` or, ignoring case, `no space left on device`), `killed` (exit status 137 or termination by `SIGKILL`), `port` (`EADDRINUSE`), `not-found` (exit status 127, a line ending in `: command not found`, or `spawn <name> ENOENT`) and `timeout` (the wrapper stopped the command, BUD-06)
2. BUD-02: WHEN a command run by `attempt.mjs run` fails, matches a signature, and its output shows no test-failure marker (`not ok `, `✖`, `✗`, `FAIL`, `failing`, `test result: FAILED`, or a line matching `Tests?:.*failed`) THEN the wrapper SHALL record the attempt as an environment failure, naming the signature, and SHALL NOT count it as a failure of the unit
3. BUD-26: IF a failed command matches a signature and its output also shows a test-failure marker THEN the wrapper SHALL count the failure as an ordinary one (AD-156)
4. BUD-03: WHEN an environment failure is recorded THEN the wrapper SHALL exit with the command's exit status (124 for a `timeout`) and print that the failure was not counted and which signature matched
5. BUD-04: IF the last three attempts of a unit are environment failures THEN the wrapper SHALL mark the unit `env-blocked` and refuse further runs with exit 3; it SHALL print a diagnosis of the machine (free memory, swap used, load average, running containers and leftover acceptance processes) when the third environment failure blocks the unit and on every refused run
6. BUD-05: WHILE a unit is `env-blocked` the hooks SHALL treat its feature as blocked, as they treat a `blocked` unit
7. BUD-06: WHEN `attempt.mjs run` starts the command THEN it SHALL stop it after `--timeout <minutes>` (60 by default) and record the stop as an environment failure with the `timeout` signature
8. BUD-27: IF `--timeout` is not a whole number of minutes, or is below 1 THEN `attempt.mjs run` SHALL refuse with exit 2 without running the command
9. BUD-07: WHEN every failing check of the Stop hook matches a signature and shows no test-failure marker THEN it SHALL let the agent stop, SHALL NOT count the red stop, and SHALL say which signatures matched; IF any failing check does not THEN the red stop SHALL count as today
10. BUD-30: IF a unit has four environment failures since its last pass or reset, in a row or not, THEN the wrapper SHALL mark it `env-blocked` as BUD-04 does, printing the same machine diagnosis when the fourth failure blocks it; a pass or a reset of the unit starts that total again (AD-167)
11. BUD-31: IF two red stops of an agent session (the hook input's `session_id`, counted in the ledger by the Stop hook) have already been left uncounted under BUD-07 THEN every later red stop of that session SHALL count as an ordinary red stop, with today's stop rules (AD-155) unchanged (AD-167)

**Independent Test**: run a command that prints `Cannot connect to the Docker daemon` and exits 1 through the wrapper, and read an unchanged failure count.

---

### P1: Unchanged reruns are refused ⭐ MVP

**User Story**: As the runner, I want a rerun with nothing changed to be refused before it runs so that a retry is never spent on the same failure.

**Why P1**: ADR 028 § 4; reruns of the same state were a common way to burn units in F0.

**Acceptance Criteria**:

1. BUD-08: WHEN `attempt.mjs run` starts a command THEN it SHALL take the fingerprint of the working directory's tree (AD-153) before the command starts, and record it with the attempt together with the command
2. BUD-09: IF the unit has a counted failure since its last pass or reset, and the fingerprint taken before this run and the command both equal those of the latest such failure THEN `attempt.mjs run` SHALL NOT run the command, SHALL NOT record an attempt, SHALL exit 4 and SHALL say that nothing changed since the last failure
3. BUD-10: WHEN the fingerprint or the command differs from those of the unit's latest counted failure since its last pass or reset, or the unit has no counted failure since then THEN the run SHALL go ahead, whatever environment failures came in between
4. BUD-28: IF the fingerprint cannot be computed (not a git repository, or git fails) THEN the command SHALL run and nothing SHALL be refused
5. BUD-11: WHEN a rerun is refused under BUD-09 THEN the ledger SHALL keep the refusal (unit, time) apart from the attempts

**Independent Test**: fail a gate, rerun it with no edit, and read exit 4 and an unchanged count; edit a file and see it run.

---

### P1: The orchestrator resets a unit once ⭐ MVP

**User Story**: As the orchestrator, I want to reset a unit once with a reason so that a unit blocked by a cause I fixed does not wait for the maintainer, while a second reset still does.

**Why P1**: 34 maintainer messages in F0 only reset a budget (AD-140).

**Acceptance Criteria**:

1. BUD-12: WHEN `attempt.mjs reset --unit <key> --by orchestrator --reason "<why>"` runs for a unit with no orchestrator reset in `ledger.resets` THEN it SHALL reset the unit and append `{ key, by, reason, at, previous }` to `ledger.resets`, which is append-only
2. BUD-13: IF `--by orchestrator` comes without a non-empty `--reason` THEN `attempt.mjs reset` SHALL refuse with exit 2
3. BUD-14: IF `ledger.resets` already holds an orchestrator reset of the unit, whatever resets came after it THEN `attempt.mjs reset --by orchestrator` SHALL refuse with exit 2 and say the next reset is the maintainer's
4. BUD-15: WHEN the agent runs `attempt.mjs reset --unit <key> --by orchestrator --reason <why>` for a unit with no orchestrator reset in the ledger THEN the gate SHALL not ask; IF `--by` is anything else or missing, the reason is missing, the command cannot be parsed, the ledger cannot be read, or the unit has an orchestrator reset THEN the gate SHALL ask
5. BUD-29: The gate and `attempt.mjs` SHALL read the same ledger and normalise a unit key the same way (trimmed, `--unit <key>` or `--unit=<key>`)
6. BUD-16: WHEN `attempt.mjs report` runs THEN it SHALL list every reset with its unit, `by`, reason and time, and every unit's environment failures and refused reruns in columns of their own

**Independent Test**: block a unit, reset it as the orchestrator with a reason, block it again, and see the second orchestrator reset refused.

---

### P2: The wrapper is easy to call and to read

**User Story**: As an agent running gates, I want the wrapper's output on disk, its end on the terminal and denials that hand me the right command so that I do not burn denials on the way I call it.

**Why P2**: 103 "quote the whole gate command" and 79 "only through the wrapper" denials in F0.

**Acceptance Criteria**:

1. BUD-17: WHEN `attempt.mjs run` finishes a command THEN it SHALL write the command's full output to `reports/attempts/<unit>/<n>.log`, with `<unit>` the unit key with `:` and `/` replaced by `-` and `<n>` the attempt number, and SHALL print the result, the duration and the output's last 60 lines (all of it when it has 60 lines or fewer)
2. BUD-18: WHEN the agent runs the wrapper with its gate command quoted whole, followed by an optional `2>&1` and then by exactly one pipe to `tail -n <digits>`, `head -n <digits>` or `grep` with only the options `-i`, `-E`, `-v`, `-c`, `-n` and one pattern that is a single-quoted string without `'` or a plain token of letters, digits and `_.:@/-` THEN the gate SHALL NOT deny it
3. BUD-19: IF anything else follows the wrapper (another pipe, `>`, `<`, `$`, a backtick, `;`, `&&`, `||`, `&`, a newline, or a pattern outside BUD-18) THEN the gate SHALL keep denying it
4. BUD-20: WHEN the gate denies a wrapper call or a direct sensor run THEN the reason SHALL hold the corrected command, ready to run: the gate command quoted whole after `--`, the feature filled in when the command runs in a feature worktree (otherwise `<feature>`), and the step the call already names (otherwise `<step>`)
5. BUD-21: `MAX_RETRIES` SHALL stay 2

**Independent Test**: run a gate through the wrapper piped to `tail -n 20` and see it allowed; run `pnpm test` directly in a worktree and read the wrapper command in the denial.

---

### P2: The guides say what the budget counts

**User Story**: As any agent, I want the guides to describe the new counting so that I stop asking for resets I can make and stop rerunning unchanged gates.

**Why P2**: `AGENTS.md` rule 11 and `references/retry-budget.md` are what agents read.

**Acceptance Criteria**:

1. BUD-22: `AGENTS.md` rule 11 SHALL say that environment failures and unchanged reruns do not count, and that the orchestrator resets a unit once with a reason while a second reset is the maintainer's
2. BUD-23: `references/retry-budget.md` SHALL describe the signatures, `env-blocked`, the refusal of unchanged reruns with exit 4, the orchestrator reset, the log files and the allowed filters

**Independent Test**: read both files.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want this row to leave the product alone and every test intact.

**Why P1**: brief revision 6 is harness-only.

**Acceptance Criteria**:

1. BUD-24: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped
2. BUD-25: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)

**Independent Test**: run both commands.

---

## Edge Cases

- BUD-04 counts only consecutive environment failures: a counted failure or a pass in between starts the count again. BUD-30 still bounds the total: a fourth environment failure since the last pass or reset blocks the unit, whatever came between.
- BUD-31 with no `session_id` in the hook input: the red stop counts as an ordinary one.
- BUD-09 covers a rerun after a commit that changed nothing in the tree: the fingerprint is the tree, not the commit;
  and a counted failure, then an environment failure, then a rerun of the same tree: refused.
- BUD-10 covers a rerun after Docker is started again with no file changed and no counted failure before.
- BUD-26 covers a test run whose output says `Module not found` or `404 not found`: no signature matches, so it counts.
- BUD-14 covers a reset of an `env-blocked` unit: it is the orchestrator's one reset of that unit.
- BUD-18 covers `2>&1 | tail -n 40`; BUD-19 covers `| tee x`, `&& git commit` and `; rm -rf x`.

---

## Requirement Traceability

| Requirement ID | Story                                       | Phase | Status  |
| -------------- | ------------------------------------------- | ----- | ------- |
| BUD-01         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-02         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-03         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-04         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-05         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-06         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-07         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-08         | P1: Unchanged reruns are refused            | Tasks | Pending |
| BUD-09         | P1: Unchanged reruns are refused            | Tasks | Pending |
| BUD-10         | P1: Unchanged reruns are refused            | Tasks | Pending |
| BUD-11         | P1: Unchanged reruns are refused            | Tasks | Pending |
| BUD-12         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-13         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-14         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-15         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-16         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-17         | P2: The wrapper is easy to call and to read | Tasks | Pending |
| BUD-18         | P2: The wrapper is easy to call and to read | Tasks | Pending |
| BUD-19         | P2: The wrapper is easy to call and to read | Tasks | Pending |
| BUD-20         | P2: The wrapper is easy to call and to read | Tasks | Pending |
| BUD-21         | P2: The wrapper is easy to call and to read | Tasks | Pending |
| BUD-22         | P2: The guides say what the budget counts   | Tasks | Pending |
| BUD-23         | P2: The guides say what the budget counts   | Tasks | Pending |
| BUD-24         | P1: Nothing else changes                    | Tasks | Pending |
| BUD-25         | P1: Nothing else changes                    | Tasks | Pending |
| BUD-26         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-27         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-28         | P1: Unchanged reruns are refused            | Tasks | Pending |
| BUD-29         | P1: The orchestrator resets a unit once     | Tasks | Pending |
| BUD-30         | P1: Environment failures do not count       | Tasks | Pending |
| BUD-31         | P1: Environment failures do not count       | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 31 total, 31 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 1 and § 3 (budget-v2) - the scope, approved by the maintainer ("Aprovo a revisão do ADR 028.")
- ADR 028 § 4 - what counts, the orchestrator's one reset, `MAX_RETRIES` unchanged (BUD-01 to BUD-16, BUD-21, BUD-26 to BUD-31; BUD-30 and BUD-31 extend ADR 028 § 4 after the security review of the diff, 2026-11-08: the three-in-a-row rule stands)
- ADR 022 - the retry budget and its units (BUD-01 to BUD-21)
- AD-140 in `.specs/STATE.md` - the maintainer's choice of one orchestrator reset per unit (BUD-12 to BUD-15)
- ADR 019 - the gate hook (BUD-15, BUD-18 to BUD-20)
- ADR 020 - contract drift (BUD-25)
- `docs/product/prd.md#NFR-11` - harness verified in CI (BUD-22 to BUD-24)

---

## Success Criteria

- [ ] In the rows after this one, no maintainer message only resets a budget, except a unit's second reset.
- [ ] The phase review lists environment failures, refused reruns and resets apart from counted failures.
