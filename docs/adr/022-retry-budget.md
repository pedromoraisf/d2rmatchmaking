# ADR 022 — Retry budget: one attempt plus two retries, enforced by code

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

With per-phase review (ADR 021), agents and subagents work for hours without a human watching. An agent that keeps
retrying a failing action — rerunning a red gate, re-dispatching a failing subagent, looping on the Stop hook, hammering
a denied command — burns time and tokens and tends to drift into weakening tests or sensors. The maintainer requires a
hard, well-defined limit with no way around it: when a subagent's action fails, it may try at most two more times.

## Decision

Every unit of agentic work gets its first attempt plus at most **2 retries** (`MAX_RETRIES = 2` in
`scripts/lib/budget.mjs`). The units are gates (`gate:<feature>/<step>`), subagent dispatches
(`dispatch:<feature>/<step>`), red stops, repeated sensor failures on the same file, and repeated identical denials.
On the third failure the unit is blocked and the hooks refuse any further attempt until the maintainer resets it.

Enforcement is deterministic, not instruction-based:

- a shared ledger in `.git/d2rmm/ledger.json` (one per repository, shared by worktrees, out of reach of agents);
- `scripts/attempt.mjs run` as the only way to run gates during a phase run (the gate hook denies direct test/gate
  commands on phase and feature branches) and the commit rule that requires a passing recorded gate;
- the PreToolUse gate counts dispatches (closed list of steps, prompt header required), counts denials and locks down
  exhausted sessions; the Stop and PostToolUse hooks count consecutive red outcomes.

Full rules and the list of closed bypasses: `.claude/skills/d2rmm-phase-runner/references/retry-budget.md`.

## Alternatives considered

- Budget written only in the skill instructions — rejected: an instruction is a guideline, not a guarantee.
- A per-feature wall-clock budget alone — kept as a secondary limit, but it does not stop fast tight loops.
- Different limits per unit kind — rejected for clarity: one number everywhere.

## Consequences

- Blocked features surface early in `decisions.md` and the phase review instead of consuming the phase.
- Gates must be declared in `tasks.md` and run through the wrapper; ad-hoc test runs on phase/feature branches are
  denied during a run (they remain free on other branches and outside a run).
- Resets are a maintainer action and are audited in the ledger.
- Changing the number of retries is a change to this ADR.
