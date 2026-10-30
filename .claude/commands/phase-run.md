---
description: Run (or resume) the active phase autonomously under its approved delegation — TLC per feature, automatic gates, escalations only.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section RUN, for phase **$ARGUMENTS**.

First reconcile state from files and git (brief `## Runner state`, each feature's `tasks.md ## Handoff`,
`git log phase/$ARGUMENTS`). Refuse to start if the brief has no maintainer approval or `pnpm specs:check` fails.
Run `node scripts/attempt.mjs status` to see blocked units. Then continue from the first unfinished step,
respecting the retry budget (1 attempt + 2 retries per unit, ADR 022): never retry a blocked unit. Report one line per completed step. Stop only for an escalation or when
every feature is done or blocked; then suggest `/phase-review $ARGUMENTS`.
