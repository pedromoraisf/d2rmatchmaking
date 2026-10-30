---
description: Draft the brief for a roadmap phase (features, scope, delegation, budgets, open questions) and stop for the maintainer's approval.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section KICKOFF, for phase **$ARGUMENTS**.

Draft `.specs/phases/$ARGUMENTS/brief.md` and `decisions.md` from the skill's templates, write `$ARGUMENTS` to
`.specs/phases/ACTIVE`, run `pnpm specs:check`, then present the brief: features table, exit criteria, open questions
with recommendations, and the delegation checkboxes. Stop and wait. Do not write the approval line yourself — the
maintainer gives it in their own words (for example: "aprovo specs e tasks da $ARGUMENTS que passarem nos gates
automáticos; delego sub-agents e local-merge-phase-branch").
