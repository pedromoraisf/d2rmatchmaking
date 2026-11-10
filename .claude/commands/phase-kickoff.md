---
description: Draft the brief for a roadmap phase (features, exit criteria, decisions, what the runner needs) and stop for the maintainer's approval.
argument-hint: F<n>
---

Use the `d2rmm-phase-runner` skill, section KICKOFF, for phase **$ARGUMENTS**.

Draft `.specs/phases/$ARGUMENTS/brief.md` and `decisions.md` from the skill's templates, write `$ARGUMENTS` to
`.specs/phases/ACTIVE`, run `pnpm specs:check`, commit, push `phase/$ARGUMENTS`, and give the maintainer the link with
the features, the exit criteria and what you need from them. Stop and wait. Write the approval line only from the
maintainer's own words.
