---
description: Run (or resume) the active phase autonomously under its approved delegation — TLC per feature, automatic gates, escalations only.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section RUN, for phase **$ARGUMENTS**.

You are the orchestrator (ADR 025). If this session is not running Opus 5.5 or Sonnet (check the model you are), stop
and ask the maintainer to restart Claude Code in the repository (the project pins `claude-opus-5-5`, medium effort).
Plan and gate yourself; delegate every task batch to `feature-worker` (Haiku) and every review/verification to the
Sonnet judges.

First run `node scripts/phase-status.mjs $ARGUMENTS --json` — it is the only source of what to do next
(ADR 024). Refuse to start if the brief has no maintainer approval or `pnpm specs:check` fails.
Run `node scripts/attempt.mjs status` to see blocked units. Then continue from the first unfinished step,
respecting the retry budget (1 attempt + 2 retries per unit, ADR 022): never retry a blocked unit. Report one line per completed step. Stop only for an escalation or when
every feature is done or blocked; then suggest `/phase-review $ARGUMENTS`.
