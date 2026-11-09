---
description: Generate the phase review (review.md) with real numbers from the sensors, for the maintainer's end-of-phase approval.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section REVIEW, for phase **$ARGUMENTS**.

Run every command the review template lists on `phase/$ARGUMENTS`, then write `.specs/phases/$ARGUMENTS/review.md`
with the real outputs. Merge the phase PR only when every one of those commands passed and the checks `verify`,
`integration`, `agent` and `secrets` passed on the phase PR's head (ADR 028 § 2, AD-170): mark the phase PR ready with
`gh pr ready <pr>` and merge it with `gh pr merge <pr> --merge` (CDL-06). Otherwise record which command or check failed
and why in review.md, and do not merge. While any maintainer item of the phase is open, do not merge the phase PR: list
the open items in review.md and stop (AD-171). Do not update the baseline. Present the verdict, the merge result, decisions to
confirm and blocked items in chat in under 15 lines, and point to the file.
