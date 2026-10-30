---
description: Generate the phase review (review.md) with real numbers from the sensors, for the maintainer's end-of-phase approval.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section REVIEW, for phase **$ARGUMENTS**.

Run every command the review template lists on `phase/$ARGUMENTS`, then write `.specs/phases/$ARGUMENTS/review.md`
with the real outputs. Do not push, open a PR or update the baseline. Present the verdict, decisions to confirm and
blocked items in chat in under 15 lines, and point to the file.
