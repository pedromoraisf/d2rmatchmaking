---
description: Generate the phase review (review.md) with real numbers, for the maintainer's end-of-phase approval.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section REVIEW, for phase **$ARGUMENTS**.

Run the review's commands on `phase/$ARGUMENTS`, read the latest nightly run for the mutation scores, and write
`.specs/phases/$ARGUMENTS/review.md` with the real outputs. Push, mark the phase PR into `main` ready, and present the
verdict, decisions to confirm and blocked items in chat in under 15 lines with the link. Merge the phase PR only after
the maintainer approves the review.
