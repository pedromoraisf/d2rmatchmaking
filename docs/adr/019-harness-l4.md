# ADR 019 — Agentic harness at L4

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Most code will be written by coding agents; corrections must happen inside the agent loop, not in human review.

## Decision

`AGENTS.md` canonical (CLAUDE.md imports it), scoped Cursor rules, Claude Code hooks (gate on PreToolUse, feedback on PostToolUse, stop on Stop) with committed scripts, Lefthook pre-commit/pre-push, CI sensors, and `harness-score --min-level 4` in CI.

## Alternatives considered

CI only.

## Consequences

The harness itself is code with tests (`pnpm test:harness`). Changing hooks always needs the maintainer.
