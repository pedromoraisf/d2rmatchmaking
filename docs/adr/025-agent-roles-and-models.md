# ADR 025 — Agent roles and models: Opus orchestrates, Haiku implements, Sonnet judges

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Phases run autonomously (ADR 021). Without a policy, every subagent inherited the main session's model, nothing pinned
the orchestrator, and TLC executed small features inline — so the most expensive model also typed most of the code,
and nothing guaranteed that planning, implementation and judgment were done by different agents.

## Decision

- **Orchestrator**: the main Claude Code session, pinned in `.claude/settings.json` to `claude-opus-5-5` with
  `effortLevel: medium` (Sonnet allowed as an alternative). It derives state (`phase-status`), writes and gates
  Specify, Design and Tasks, dispatches, integrates and writes the phase review. It never writes feature code.
- **Implementers**: `feature-worker` subagents pinned to **Haiku** (`effort: medium`). They execute TLC task batches
  (`execute-batch-1..9`) in the feature's worktree; N run in parallel, one per runnable feature. Execution is always
  delegated, overriding TLC's "≤ ~8 tasks inline".
- **Judges**: `spec-reviewer`, `architecture-reviewer`, `security-reviewer` and `verifier` pinned to **Sonnet**
  (`effort: medium`): independent of the author and on a different model from the implementer.
- `scripts/lib/model-policy.mjs` maps each dispatch step to its subagent type; the PreToolUse gate denies a dispatch
  to another type, a `model` or `effort` override, or a planning step (spec, design, tasks) as a dispatch. A test
  keeps the agents' frontmatter and `.claude/settings.json` in sync with the policy.
- Work inside `.claude/worktrees/<feature>` is judged as that feature's branch (commit rule, blocked features) and
  edits there get the same protections as the repository paths.

## Alternatives considered

- Haiku for reviewers and the Verifier too — cheaper, but the judge would share the implementer's blind spots.
- Opus or Sonnet implementers — higher quality per task at several times the cost; the gates, acceptance scenarios
  and retry budget (ADR 022) are what keep Haiku's output honest.
- Model choice per feature in the brief — more knobs; revisit if Haiku blocks repeatedly on core-domain features.

## Consequences

- The plan must be precise: Haiku executes tasks as written and returns a task it cannot do instead of improvising;
  the orchestrator replans. Expect more blocked tasks on Complex features, surfaced by the retry budget.
- Changing a pin (e.g. a Sonnet implementer for a hard feature) is a maintainer decision: edit the policy, the agent
  frontmatter and this ADR together.
- The orchestrator model is a project setting: a session started with another `--model` is outside the policy; the
  phase-run command checks it at start.
