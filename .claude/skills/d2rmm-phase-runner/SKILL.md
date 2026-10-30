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

## Retry budget — 1 attempt + 2 retries, no exceptions

Every unit of work (gate, subagent dispatch, red stop, repeated sensor failure, repeated denial) gets its first
attempt plus **at most 2 retries**. The third failure blocks the unit and the hooks refuse any further attempt by any
route; only the maintainer resets it. This is enforced by code (ADR 022), not by this text — see
[`references/retry-budget.md`](references/retry-budget.md). Consequences for how you work:

- During a run, run every gate through `node scripts/attempt.mjs run --feature <f> --step <T#|spec|tasks|proofs|verification|integration> -- "<cmd>"`.
- Start every subagent prompt with `[d2rmm feature=<f> step=<step>]` (closed list of steps in retry-budget.md).
- Before each retry, change something real (root cause), never the test, the gate or the sensor.
- When a unit blocks: record it, move on, never look for another route.

## Idempotency contract (ADR 024)

The runner never decides "where we are" from memory, chat or notes. It asks the evidence:

1. **Start every step with `node scripts/phase-status.mjs --json`.** It derives the phase's next step and each
   feature's next step from `.specs/` files, approval lines, git commit trailers and the retry ledger. Do exactly the
   step it reports for each runnable feature — never one you remember.
2. **Record progress only as evidence**: the artifact itself (spec, acceptance.feature, design, tasks, proofs,
   verification) and a commit whose trailers say what it closes:
   `Feature: <feature>` + `Task: T<n>`, or `Feature: <feature>` + `Step: spec|design|tasks|proofs|verification|integration|fix`.
   The commit-msg hook rejects commits on feature branches without them.
3. **Re-running is safe.** A step whose evidence exists is skipped by construction. Artifacts are regenerated, not
   appended. An approved spec, tasks or brief is never rewritten — a change to it is a new approval.
4. **`## Runner state` is generated** (`phase-status --write`), together with the committed retry-ledger snapshot
   `.specs/phases/<F>/attempts.json`. Never edit either by hand.
5. After a compaction or in a new session: re-read the files below, run `phase-status`, and continue. If evidence and
   a note disagree, evidence wins; if two pieces of evidence disagree (e.g. an approval line without its gate run),
   stop and escalate.

## Read first, every time (also after a compaction)

1. This file to the end, then `.claude/skills/tlc-spec-driven/SKILL.md` to the end.
2. `.specs/phases/ACTIVE`, the active `brief.md`, `decisions.md`, and `.specs/STATE.md` (Decisions + Handoff).
3. `node scripts/phase-status.mjs` — the only source of "what's next".

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

0. Preconditions: the previous phase reports `closed` in `phase-status F<n-1>` (review approved and `phase/F<n-1>`
   merged into `main`). Then, on a new `phase/F<n>` branch from `main`, tighten the baseline with the merged numbers:
   `pnpm quality:collect && pnpm quality:ratchet --context phase --update`. If `brief.md` already exists and is
   approved, do not touch it — report and stop; if it is an unapproved draft, update it in place.
1. Read the roadmap (its `## Requirement coverage` lists the requirements this phase must cover — every one must
   appear in the brief's features "Covers"; `pnpm specs:check` enforces it once approved) (`.specs/phases/ROADMAP.md`), PRD and Design Doc sections the phase touches, ADRs, lessons
   (`python3 .claude/skills/tlc-spec-driven/scripts/lessons.py list --status confirmed`).
2. Draft `.specs/phases/F<n>/brief.md` from `references/templates/brief.md`: goal, exit criteria, features with size
   (TLC auto-sizing), dependency order and which can run in parallel, FR/NFR covered, budgets, risks, open questions
   the maintainer must answer **now** (product gray areas that cannot take a conservative default).
3. Create `.specs/phases/F<n>/decisions.md` from its template. Write `F<n>` to `.specs/phases/ACTIVE`.
4. Present the brief and stop. The maintainer answers the open questions and approves with their words + delegation.

## RUN — `/phase-run F<n>`

Refuse to start unless `phase-status` reports `run` (brief approved) and `pnpm specs:check` passes. Then loop:
`phase-status --json` → for every entry in `runnable`, do that feature's `step` (in parallel worktrees when
`sub-agents` is delegated; a feature waits until its dependencies are integrated) → `phase-status --write` → repeat
until no feature is runnable. `phaseBlocked: true` is an escalation.

### 1. Branch / worktree

`phase/<F>` from `main` (once). Each feature: `git worktree add .claude/worktrees/<feature> -b feat/<F>-<feature> phase/<F>`.
Parallel features each get a `feature-worker` subagent in their own worktree (prompt header
`[d2rmm feature=<feature> step=feature]`); a feature that depends on another waits
for it to merge into `phase/<F>`.

### 2. Specify (TLC `references/specify.md`)

- Write `acceptance.feature` next to `spec.md` from `references/templates/acceptance.feature` (ADR 023): English
  Gherkin, one or more scenarios per requirement ID, tagged `@<REQ-ID>` (+ `@FR-xx`/`@INV-xx`), describing what a
  player or the agent does and observes. These scenarios are the acceptance tests — never copy them into code.
- Gray areas: answer from PRD → Design Doc → ADRs → STATE decisions → lessons. If still open and it is a **product**
  decision the brief did not settle, take the **conservative default** (`references/gates.md#conservative-defaults`),
  record `### AD-NNN — <decision> (assumed)` in `.specs/STATE.md` and a line in `decisions.md`. If no conservative
  default exists (it would change what users see in a way the PRD contradicts), **escalate**.
- **Spec gate** (all must pass, in order):
  1. `node scripts/attempt.mjs run --feature <feature> --step spec -- "python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py <feature>"` exits 0.
  2. `node scripts/attempt.mjs run --feature <feature> --step spec -- "node scripts/acceptance-check.mjs <feature>"` exits 0.
  3. Traceability: every requirement cites an `FR-xx`/`NFR-xx`/ADR in `## Sources`, and every FR/NFR the brief assigns
     to the feature is covered (`references/gates.md#traceability`).
  4. `spec-reviewer` subagent returns `VERDICT: PASS` (findings fixed; dispatch step `review-spec`, 1 + 2 retries).
- Then write the delegated approval line in `spec.md`.

### 3. Design (Large/Complex only)

`references/design.md` from TLC. Then `architecture-reviewer` (and `security-reviewer` when the feature touches auth,
the agent, secrets, uploads or the network edge) must return `VERDICT: PASS`. An architecture choice that contradicts
an accepted ADR is an escalation — propose a new ADR instead.

### 4. Tasks

TLC `references/tasks.md`. **Tasks gate:** `validate_tasks.py <feature>` exits 0, every criterion has a check with a
proof command, `**Mutations**:` ≥ 3 (all run as step `tasks` through `attempt.mjs`). Write the delegated approval in
`tasks.md`, then `validate_tasks.py <feature> --execute` must exit 0 (same step).

### 5. Execute

TLC `references/implement.md`, one atomic commit per task (`check_commit.py`). Each task's gate runs as
`attempt.mjs run --step T<n>`; the commit is refused until that gate passed. Hooks give feedback on every edit and
block the stop while sensors are red — each within the retry budget. On exhaustion (exit 3, or a hook saying the
session is exhausted) mark the task and the feature **blocked** in `tasks.md ## Handoff`, add it to
`decisions.md → Blocked`, and move on to features that do not depend on it. A blocked feature that blocks every
remaining feature of the phase is an escalation.

### 6. Verify (fresh agent, always)

`check_proofs.py <feature>` (step `proofs`) → dispatch the `verifier` subagent (step `verify`; author ≠ verifier) with
TLC `references/validate.md` → fix findings in one pass → `check_proofs.py --mutations` (step `proofs`) and, if TLC's
round 2 applies, step `verify-r2` → `validate_verification.py <feature>` (step `verification`) exits 0.

### 7. Integrate

In the feature worktree, all as step `integration` through `attempt.mjs`: `pnpm check` green, `pnpm quality:collect && pnpm quality:ratchet --context pr` green,
`harness-score --min-level 4` green, OpenAPI drift clean. Then (with `local-merge-phase-branch`) merge into `phase/<F>`
with `--no-ff`, rerun `pnpm check` on `phase/<F>`, remove the worktree. Without the scope, leave it ready and list it
in the review. **Never push** — pushing `phase/<F>` and opening the PR to `main` happen after the phase review, with
the maintainer's go-ahead.

### 8. Lessons

TLC `references/lessons.md` after each feature's gate.

After each integration, run `node scripts/phase-status.mjs --write` on `phase/<F>` and commit the regenerated
`## Runner state` and `attempts.json` (`chore(specs): runner state <F>`), so a compacted or new session — on any
machine — resumes from the same evidence.

## Escalations — stop and ask (the gate hook enforces most as "ask")

See `references/escalation.md`. In short: push or merge to `main`; deploy; production database; creating or changing
secrets; changing an accepted ADR; deleting/skipping/weakening tests; lowering thresholds or the quality baseline;
disabling or loosening a sensor; a product gray area with no conservative default; a blocked feature that blocks the
phase. Everything else is decided, recorded and shown in the review.

## REVIEW — `/phase-review F<n>`

Precondition: `phase-status` reports `review` (every feature done or blocked).

1. On `phase/<F>`: `pnpm check`; `pnpm harness:json`; `pnpm quality:collect`;
   `pnpm quality:ratchet --context phase`; for each feature `validate_verification.py`; `node scripts/attempt.mjs report`.
2. Generate `.specs/phases/F<n>/review.md` from `references/templates/review.md` with **real numbers** from those runs
   (never estimates): exit criteria ✓/✗ with proof links, features and commits, assumed decisions to confirm, blocked
   items with the retry-budget report (units, attempts, last error, resets), harness score and ratchet deltas, mutation scores, CI time, what changed in the harness, risks for the next
   phase, and the exact commands the maintainer runs to push and open the PR.
3. Stop. The maintainer accepts by writing the approval line in `review.md` (then pushes `phase/<F>` and merges the PR
   to `main`; `phase-status` moves to `closed`) or sends items back (they become a follow-up feature row in the brief,
   which needs the maintainer's approval like any brief change).

## Output

Write artifacts in a plain, decided voice (TLC `coding-principles.md`). Chat updates are one line each: which feature,
which step, what is blocked. Review content goes in `review.md`, not chat.
