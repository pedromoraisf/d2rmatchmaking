# ADR 004 — Dependency rules as a sensor

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Coding agents (and humans) drift across layers unless the rule fails fast.

## Decision

`.dependency-cruiser.cjs` encodes the layer and module rules and runs on edit (Claude Code PostToolUse hook), in pre-commit (Lefthook) and in CI. A deliberate violation fixture is kept as a test of the rules (F0).

## Alternatives considered

ESLint boundaries plugin; code review only.

## Consequences

Deterministic feedback inside the agent loop. Relaxing a rule is an escalation to the maintainer.
