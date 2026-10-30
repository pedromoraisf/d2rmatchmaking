---
name: d2rmm-phase-runner
description: Run a whole roadmap phase of D2R Match Making autonomously on top of tlc-spec-driven — kickoff brief, per-feature Specify/Design/Tasks/Execute with automatic gates instead of per-feature human approvals, reviewer subagents, parallel worktrees, budgets, escalations, and a generated phase review. Use when the user says "kickoff F<n>", "run phase", "continue the phase", "phase review", "/phase-kickoff", "/phase-run", "/phase-review", or asks to build a feature that belongs to a roadmap phase. Do NOT use for one-off fixes outside a phase (use tlc-spec-driven directly).
---

# D2R Match Making — Phase Runner

Wraps **tlc-spec-driven** (`.claude/skills/tlc-spec-driven/SKILL.md`, the method) so the maintainer reviews **once per
phase**. TLC's rules all still hold; this skill only replaces *who* gives the two per-feature approvals and adds the
gates that make that safe. Decision record: `docs/adr/021-automated-phase-delivery.md`.

```
KICKOFF (human)  →  RUN (agent, gated)  →  REVIEW (human)
brief.md approved    per feature: TLC      review.md generated
with delegation      + automatic gates     maintainer accepts / sends back
                     escalations interrupt
```

## Read first, every time (also after a compaction)

1. This file to the end, then `.claude/skills/tlc-spec-driven/SKILL.md` to the end.
2. `.specs/phases/ACTIVE`, the active `brief.md`, `decisions.md`, and `.specs/STATE.md` (Decisions + Handoff).
3. `runner-state` in the brief (`## Runner state`) and `git log --oneline phase/<F>..` — evidence wins over notes.

## The delegation contract

The phase brief's approval is the only human approval during the run. It is valid only if:

- `.specs/phases/<F>/brief.md` has `**Approved**: <date> - user: "<words>"` written from the maintainer's own message
  (the gate hook asks the maintainer to confirm that edit — never write it unprompted);
- `## Delegation` ticks the scopes the maintainer granted. Unticked = not delegated = ask.

| Scope | What it lets the runner do without asking |
| --- | --- |
| `specs-and-tasks` | Write the per-feature approvals once the automatic gates pass |
| `sub-agents` | Dispatch feature workers, the Verifier and the reviewers (TLC's offer-then-confirm is answered here) |
| `harness-edits` | Edit sensor/harness config (lint, depcruise, CI, Stryker…) — **only to tighten or extend**. The gate hook still asks for `.claude/hooks/**` and `.claude/settings.json` |
| `local-merge-phase-branch` | Merge a green feature branch into `phase/<F>` locally |

A per-feature approval line under delegation is exactly:

```
**Approved**: <YYYY-MM-DD> - user: "<kickoff words, verbatim>" (delegated via .specs/phases/<F>/brief.md)
```

It satisfies TLC's `APPROVED_RE` and is checked by the gate hook and `pnpm specs:check`. Paraphrasing, or writing it
before the gates pass, is a fabricated approval.

## KICKOFF — `/phase-kickoff F<n>`

1. Read the roadmap (`.specs/phases/ROADMAP.md`), PRD and Design Doc sections the phase touches, ADRs, lessons
   (`python3 .claude/skills/tlc-spec-driven/scripts/lessons.py list --status confirmed`).
2. Draft `.specs/phases/F<n>/brief.md` from `references/templates/brief.md`: goal, exit criteria, features with size
   (TLC auto-sizing), dependency order and which can run in parallel, FR/NFR covered, budgets, risks, open questions
   the maintainer must answer **now** (product gray areas that cannot take a conservative default).
3. Create `.specs/phases/F<n>/decisions.md` from its template. Write `F<n>` to `.specs/phases/ACTIVE`.
4. Present the brief and stop. The maintainer answers the open questions and approves with their words + delegation.

## RUN — `/phase-run F<n>`

Refuse to start unless the brief is approved (`pnpm specs:check` passes and the brief has an approval line). Then,
for features in dependency order (independent ones in parallel when `sub-agents` is delegated):

### 1. Branch / worktree

`phase/<F>` from `main` (once). Each feature: `git worktree add .claude/worktrees/<feature> -b feat/<F>-<feature> phase/<F>`.
Parallel features each get a `feature-worker` subagent in their own worktree; a feature that depends on another waits
for it to merge into `phase/<F>`.

### 2. Specify (TLC `references/specify.md`)

- Gray areas: answer from PRD → Design Doc → ADRs → STATE decisions → lessons. If still open and it is a **product**
  decision the brief did not settle, take the **conservative default** (`references/gates.md#conservative-defaults`),
  record `### AD-NNN — <decision> (assumed)` in `.specs/STATE.md` and a line in `decisions.md`. If no conservative
  default exists (it would change what users see in a way the PRD contradicts), **escalate**.
- **Spec gate** (all must pass, in order):
  1. `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py <feature>` exits 0.
  2. Traceability: every requirement cites an `FR-xx`/`NFR-xx`/ADR in `## Sources`, and every FR/NFR the brief assigns
     to the feature is covered (`references/gates.md#traceability`).
  3. `spec-reviewer` subagent returns `VERDICT: PASS` (findings fixed, max 2 rounds).
- Then write the delegated approval line in `spec.md`.

### 3. Design (Large/Complex only)

`references/design.md` from TLC. Then `architecture-reviewer` (and `security-reviewer` when the feature touches auth,
the agent, secrets, uploads or the network edge) must return `VERDICT: PASS`. An architecture choice that contradicts
an accepted ADR is an escalation — propose a new ADR instead.

### 4. Tasks

TLC `references/tasks.md`. **Tasks gate:** `validate_tasks.py <feature>` exits 0, every criterion has a check with a
proof command, `**Mutations**:` ≥ 3. Write the delegated approval in `tasks.md`, then
`validate_tasks.py <feature> --execute` must exit 0.

### 5. Execute

TLC `references/implement.md`, one atomic commit per task (`check_commit.py`). Hooks give feedback on every edit and
block the stop while sensors are red. **Budgets** (from the brief; defaults in `references/gates.md#budgets`):
3 attempts per task gate; on exhaustion mark the task and the feature **blocked** in `tasks.md ## Handoff`, add it to
`decisions.md → Blocked`, and move on to features that do not depend on it. A blocked feature that blocks every
remaining feature of the phase is an escalation.

### 6. Verify (fresh agent, always)

`check_proofs.py <feature>` → dispatch the `verifier` subagent (author ≠ verifier) with TLC `references/validate.md`
→ fix findings in one pass → `check_proofs.py --mutations` → `validate_verification.py <feature>` exits 0.

### 7. Integrate

In the feature worktree: `pnpm check` green, `pnpm quality:collect && pnpm quality:ratchet --context pr` green,
`harness-score --min-level 4` green, OpenAPI drift clean. Then (with `local-merge-phase-branch`) merge into `phase/<F>`
with `--no-ff`, rerun `pnpm check` on `phase/<F>`, remove the worktree. Without the scope, leave it ready and list it
in the review. **Never push** — pushing `phase/<F>` and opening the PR to `main` happen after the phase review, with
the maintainer's go-ahead.

### 8. Lessons

TLC `references/lessons.md` after each feature's gate.

Update `## Runner state` in the brief after every step (feature → phase → status → last commit), so a compacted or new
session resumes from files, not memory.

## Escalations — stop and ask (the gate hook enforces most as "ask")

See `references/escalation.md`. In short: push or merge to `main`; deploy; production database; creating or changing
secrets; changing an accepted ADR; deleting/skipping/weakening tests; lowering thresholds or the quality baseline;
disabling or loosening a sensor; a product gray area with no conservative default; a blocked feature that blocks the
phase. Everything else is decided, recorded and shown in the review.

## REVIEW — `/phase-review F<n>`

1. On `phase/<F>`: `pnpm check`; `pnpm harness:json`; `pnpm quality:collect`;
   `pnpm quality:ratchet --context phase`; for each feature `validate_verification.py`.
2. Generate `.specs/phases/F<n>/review.md` from `references/templates/review.md` with **real numbers** from those runs
   (never estimates): exit criteria ✓/✗ with proof links, features and commits, assumed decisions to confirm, blocked
   items, harness score and ratchet deltas, mutation scores, CI time, what changed in the harness, risks for the next
   phase, and the exact commands the maintainer runs to push and open the PR.
3. Stop. The maintainer accepts (then: push `phase/<F>`, PR to `main`, `pnpm quality:ratchet --update` after merge)
   or sends items back (they become a follow-up feature in the same phase).

## Output

Write artifacts in a plain, decided voice (TLC `coding-principles.md`). Chat updates are one line each: which feature,
which step, what is blocked. Review content goes in `review.md`, not chat.
