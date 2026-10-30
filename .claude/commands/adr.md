---
description: Write a new Architecture Decision Record (Proposed) in docs/adr, optionally superseding an accepted one.
argument-hint: <title> [supersedes NNN]
---

Create `docs/adr/<next number>-<kebab-title>.md` from `docs/adr/000-template.md` for: **$ARGUMENTS**.

Fill Context, Decision, Alternatives, Consequences from the Design Doc, PRD and code. Status is always **Proposed** —
only the maintainer accepts an ADR. If it supersedes an accepted ADR, do not edit the old one; add
"Superseded by ADR NNN (proposed)" to the review notes and raise it as an escalation. Add the row to `docs/adr/README.md`.
