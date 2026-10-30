# ADR 021 — Automated per-phase delivery

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The maintainer wants to review once per roadmap phase, not per feature or task, while keeping TLC spec-driven development's guarantees (approved specs and tasks, atomic commits, independent verification).

## Decision

The project skill `d2rmm-phase-runner` wraps TLC. The maintainer approves a phase brief with explicit delegation scopes; per-feature approvals are then written only after automatic gates pass (TLC scripts, traceability, reviewer subagents), quoting the kickoff words and citing the brief. Gray areas take conservative defaults recorded as assumed decisions. Escalations (push/merge to main, deploy, production DB, secrets, accepted ADRs, weakening tests or sensors, phase-blocking failures) still interrupt. A quality ratchet (`.quality-baseline.json`) only tightens. Features run in parallel git worktrees. The phase ends with a generated `review.md`.

## Alternatives considered

Per-feature human approvals (TLC default); fully autonomous with no kickoff approval.

## Consequences

Fewer interruptions with the same evidence. The gate hook and `pnpm specs:check` enforce the delegation format; the maintainer's review load moves to `review.md` and `decisions.md`. Runs locally in Claude Code first; headless GitHub Actions later needs a paid API key (new ADR).
