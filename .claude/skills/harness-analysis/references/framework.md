# Harness Analysis Framework (HAF) v1

A fixed frame for describing and scoring the **agentic harness** of a repository: everything that steers, checks,
stops and measures a coding agent working in it. The frame never changes between repositories — only the evidence and
the scores do — so two reports can be compared row by row.

> **Harness** = guides (feed-forward) + sensors (feedback) + gates (stop) + state (memory) + orchestration (who works)
>
> - governance (who decides) + measurement (is it getting better). Product code is out of scope.

## 1. The maturity scale (used for every criterion)

The scale asks one question: **who enforces this, and do we know it works?**

| Score | Level           | Who enforces it                                                                 | Typical evidence                                                            |
| ----- | --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0     | Absent          | nobody                                                                          | nothing found                                                               |
| 1     | Ad hoc          | the agent's goodwill (a prompt, a README line)                                  | instruction text only, not referenced from the agent's entry point          |
| 2     | Documented      | a convention the agent is told about and a human checks                         | AGENTS.md / rules / skill text, PR template, review checklist               |
| 3     | Enforced        | code that runs without anyone asking (hook, CI, validator)                      | hook script, CI job, git hook, linter rule, validator script                |
| 4     | Self-correcting | code that is itself tested and measured, and feeds the result back to the agent | tests for the enforcer, a ratchet/score, a fixture proving the sensor fails |

Rules for scoring:

- Score what the **repository** contains, not what a person's global setup might add.
- A criterion scores the **lowest** level that covers its whole scope. A hook that blocks 9 of 10 risky commands with a
  documented hole is a 3, not a 4.
- Every score cites evidence as `path` or `path:line`. No evidence → 0.
- `N/A` only when the criterion cannot apply (e.g. no remote CI host at all). N/A is excluded from averages and must
  say why.

## 2. The ten pillars and forty criteria

Pillar IDs and criterion IDs are stable. Never renumber; a future version appends.

### P1 — Context & Guides (CTX) · feed-forward

What the agent knows before it acts.

| ID    | Criterion                    | 4 looks like                                                                                                               |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| CTX-1 | Canonical instruction file   | One entry file (AGENTS.md / CLAUDE.md) with map, commands, hard rules; other tools import it; a check keeps it substantive |
| CTX-2 | Scoped & progressive context | Path-scoped rules and on-demand skills/references instead of one giant file; scoping is checked                            |
| CTX-3 | Versioned domain & decisions | ADRs, glossary, invariants in the repo, cited by rules and by gate messages                                                |
| CTX-4 | Multi-tool parity            | Every agent tool used on the repo gets the same guides **and** the same guardrails, with a drift check                     |

### P2 — Method & Traceability (MET)

How work is shaped from requirement to commit.

| ID    | Criterion                       | 4 looks like                                                                                |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| MET-1 | Defined delivery method         | A written method (spec → design → tasks → execute) whose artifacts are validated by scripts |
| MET-2 | Requirement → test traceability | Every requirement ID reaches a spec, a test tag and a proof; a checker fails on gaps        |
| MET-3 | Atomic units with per-unit gate | One task = one gate = one commit; commits refused without a passing gate                    |
| MET-4 | Decision log for gray areas     | Assumed decisions recorded with a default and queued for human review; a reviewer checks it |

### P3 — Orchestration & Roles (ORQ)

Who does the work, with which powers.

| ID    | Criterion                  | 4 looks like                                                                             |
| ----- | -------------------------- | ---------------------------------------------------------------------------------------- |
| ORQ-1 | Roles with least privilege | Planner / implementer / reviewer roles, each with a minimal tool list enforced by config |
| ORQ-2 | Model & effort policy      | Model per role pinned in config; overrides refused by a gate; policy unit-tested         |
| ORQ-3 | Isolation of parallel work | Parallel agents in separate worktrees/branches with separate budgets and state           |
| ORQ-4 | Independent verification   | Author ≠ verifier (fresh context, ideally a different model), enforced by dispatch rules |

### P4 — Action Guardrails (GRD) · before the tool runs

What stops a bad action before it happens.

| ID    | Criterion                             | 4 looks like                                                                                                                           |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GRD-1 | Destructive & remote operations       | push, force-push, reset, rm -r, deploy, release, merge to main: deny or ask, tested                                                    |
| GRD-2 | Secrets                               | Agent cannot read/print secret files; secret scanning local + CI                                                                       |
| GRD-3 | Protected artifacts & self-protection | Vendored code, applied migrations, accepted decisions, baselines and the harness itself cannot be changed silently                     |
| GRD-4 | Robustness & fail-closed              | Enforcer errors become "ask", not "allow"; evasion paths (shell indirection, scripts, other tools) are closed or documented and tested |

### P5 — Sensors & Feedback Loop (SEN) · after the tool runs

How fast and how precisely the agent learns it was wrong.

| ID    | Criterion                       | 4 looks like                                                                                  |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| SEN-1 | Per-edit feedback               | Format/lint/arch/related tests run on the edited file and errors return to the agent          |
| SEN-2 | End-of-turn barrier             | The agent cannot end a turn (or a subagent) with red affected checks; termination guaranteed  |
| SEN-3 | Local git hooks                 | pre-commit, commit-msg, pre-push run the same sensors as CI; bypass flags blocked             |
| SEN-4 | Architecture & boundary sensors | Layering/module rules encoded as a tool, with fixtures proving the sensor fails on violations |

### P6 — Test Integrity & Verification (VER)

Whether "green" means "correct".

| ID    | Criterion                        | 4 looks like                                                                                           |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| VER-1 | Test pyramid coverage            | Unit, integration, e2e/acceptance and non-functional (load/perf) all present and run                   |
| VER-2 | Anti-weakening                   | Removing, skipping, focusing or loosening tests is detected and escalated, with tests for the detector |
| VER-3 | Mutation / test-strength measure | Mutation testing with scope rules, thresholds and a ratchet, on all core code                          |
| VER-4 | Proof per acceptance criterion   | Each criterion maps to a command that proves it; a script runs and validates the proofs                |

### P7 — Remote Barriers (REM) · CI, branches, releases

What still holds if every local control is skipped.

| ID    | Criterion                       | 4 looks like                                                                                     |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| REM-1 | CI mirrors local sensors        | One command (`check`) runs the same suite locally and in CI; CI fails on drift                   |
| REM-2 | Branch & tag protection as code | Rulesets versioned in the repo, required checks listed, drift between repo copy and host checked |
| REM-3 | Controlled release & deploy     | Deploys/releases behind protected environments/tags, workflows themselves tested                 |
| REM-4 | Supply chain                    | Dependency updates for every ecosystem, license/ban checks, secret scan, pinned actions          |

### P8 — State, Memory & Resumption (EST)

Whether the next session knows where the last one stopped.

| ID    | Criterion                           | 4 looks like                                                                                 |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| EST-1 | Evidence-derived state              | "What's next" computed from files/commits by a script, never from memory or chat             |
| EST-2 | Compaction / new-session resilience | A "read first" contract plus idempotent steps; re-running is safe by construction            |
| EST-3 | Cross-cycle learning                | Lessons captured, promoted on corroboration, quarantined on failure — and actually populated |
| EST-4 | Auditable work ledger               | Attempts, failures, resets recorded tamper-resistantly and reported to the human             |

### P9 — Autonomy Governance (GOV)

How much the agent may decide alone, and how that is bounded.

| ID    | Criterion                               | 4 looks like                                                                              |
| ----- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| GOV-1 | Explicit human touchpoints & delegation | Named moments where a human approves; delegation scopes written down and verified by code |
| GOV-2 | Escalation routing                      | High-risk actions reach the human as a prompt mid-run; the list is code, tested           |
| GOV-3 | Loop termination & retry budget         | Every failing unit has a bounded number of retries; exhaustion blocks it by code          |
| GOV-4 | Cost & time budgets                     | Token/cost/wall-clock budgets per unit or phase, measured and enforced                    |

### P10 — Measurement & Harness Evolution (EVO)

Whether the harness is treated as a product that improves.

| ID    | Criterion                        | 4 looks like                                                                                  |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| EVO-1 | Harness as tested code           | Hooks, gates, validators have their own test suite run in CI                                  |
| EVO-2 | Maturity score & quality ratchet | An external score and a baseline that only tightens; every metric actually measured           |
| EVO-3 | Agent effectiveness telemetry    | Success rate, retries, blocks, cycle time, cost per task collected and trended; harness evals |
| EVO-4 | Harness change control           | Changes to the harness need a decision record and the maintainer; enforced by the gate        |

## 3. Component inventory (fixed columns)

Every component the analysis finds goes in one table with these columns, in this order:

| Column         | Allowed values / content                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| Component      | short name                                                                                 |
| Kind           | `guide` · `sensor` · `gate` · `state` · `orchestration` · `governance` · `measurement`     |
| Trigger        | one of the control points in §4 (e.g. `on-edit`, `pre-commit`, `ci-pr`)                    |
| Responsibility | one sentence: what it is for                                                               |
| Actions        | what it can do: `inform` · `fix` · `warn` · `block` · `deny` · `ask` · `record` · `report` |
| Enforcement    | `soft` (text the agent reads) · `hard` (code that runs)                                    |
| Pillars        | criterion IDs it serves, e.g. `GRD-1, GOV-2`                                               |
| Evidence       | path                                                                                       |

## 4. Control points (fixed lifecycle)

The lifecycle of one unit of agent work. The coverage matrix marks, for each control point, which components act there.
An empty row is a gap by definition.

| #   | Control point   | Moment                                                     |
| --- | --------------- | ---------------------------------------------------------- |
| C1  | `session-start` | the agent loads context (instruction files, rules, skills) |
| C2  | `plan`          | the agent shapes the work (spec, design, tasks)            |
| C3  | `pre-tool`      | before a tool call executes (shell, edit, read, dispatch)  |
| C4  | `on-edit`       | right after a file changes                                 |
| C5  | `turn-end`      | the agent (or a subagent) tries to stop                    |
| C6  | `pre-commit`    | git pre-commit and commit-msg                              |
| C7  | `pre-push`      | git pre-push                                               |
| C8  | `ci-pr`         | CI on a pull request / push                                |
| C9  | `merge`         | protected-branch rules, required checks                    |
| C10 | `release`       | deploy, tag, publish                                       |
| C11 | `scheduled`     | nightly / periodic jobs                                    |
| C12 | `review`        | the human checkpoint (phase/PR review)                     |

## 5. Aggregation

- **Pillar score** = mean of its criterion scores (N/A excluded), one decimal.
- **Overall score** = mean of the ten pillar scores, one decimal. Also report `earned/max` points (max = 4 × applicable
  criteria).
- **Profile** — the overall level name is the floor of the overall score mapped to the scale in §1, **capped** at the
  lowest pillar + 1. A repo that is excellent everywhere but has one pillar at 0 is not "Self-correcting".
- **Hard/soft ratio** — share of inventory components with `Enforcement = hard`.
- **Gaps** — every criterion below 3, sorted by (score asc, pillar order). Each gap gets one concrete next step.

## 6. Comparing two repositories

Compare scorecards (`scorecard.json`, schema in `scorecard.schema.json`) criterion by criterion with
`scripts/compare_scorecards.py`. Read the result in this order:

1. **Profile and overall** — the headline difference.
2. **Pillar deltas** — where each repo is stronger (|Δ| ≥ 1 is significant).
3. **Criterion deltas** — a ≥ 2-point gap usually means one repo enforces by code what the other only writes down.
4. **Control-point coverage** — a control point covered in A and empty in B is the cheapest opportunity for B.
5. **Transferable components** — for every criterion where A > B, the inventory rows of A that serve it are the
   candidates to port.
