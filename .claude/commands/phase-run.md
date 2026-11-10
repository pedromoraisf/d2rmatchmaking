---
description: Run (or resume) the active phase autonomously — spec, tasks and workers per feature, one PR per feature merged when CI is green, escalations only.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section RUN, for phase **$ARGUMENTS**.

Run `node scripts/phase-status.mjs $ARGUMENTS` first; it is the only source of what to do next. Start only if it
reports `run`. Write specs, designs and tasks yourself; dispatch every task batch to a `feature-worker` with
`isolation: "worktree"`, runnable features in parallel; open one PR per feature into `phase/$ARGUMENTS`, have it
reviewed once, and merge it with `gh pr merge <pr> --merge` when CI is green. After three failures of the same thing,
record the blocker and move on. Report one line per completed step; stop only for an escalation or when every feature
is merged or blocked, then suggest `/phase-review $ARGUMENTS`.
