---
name: d2rmm-phase-runner
description: Run a whole roadmap phase of D2R Match Making autonomously — kickoff brief, per-feature spec, tasks and execution by parallel workers, one pull request per feature merged when CI is green, and a generated phase review. Use when the user says "kickoff F<n>", "run phase", "continue the phase", "phase review", "/phase-kickoff", "/phase-run", "/phase-review", or asks to build a feature that belongs to a roadmap phase. Do NOT use for one-off fixes outside a phase.
---

# D2R Match Making — Phase Runner (lean, ADR 029)

The maintainer stops the work twice per phase: to approve the brief and to approve the review. Everything between is
the runner's. CI is the quality gate; the hooks only guard what cannot be undone.

```
KICKOFF (maintainer approves)  →  RUN (agents, CI-gated PRs)  →  REVIEW (maintainer approves)
```

## Read first, every session (also after a compaction)

1. This file, `AGENTS.md` and `docs/engineering/lessons.md`.
2. `.specs/phases/ACTIVE`, the active `brief.md` and `decisions.md`.
3. `node scripts/phase-status.mjs` — the only source of "what's next". It reads the brief, each feature's files and
   which feature branches merged into `phase/<F>`. Never decide from memory.

## Roles (ADR 025)

| Role         | Who                                                   | Does                                                                     |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Orchestrator | this session (Opus)                                   | writes spec, design and tasks; dispatches; opens and merges PRs; reviews |
| Implementer  | `feature-worker` (Haiku), one per feature             | executes a task batch in its own worktree, commits, pushes               |
| Reviewers    | `architecture-reviewer`, `security-reviewer` (Sonnet) | comment once on a feature PR's diff                                      |

Hypothesis H-001 (ADR 029): if workers still need many fix rounds, try Sonnet workers. Record fix rounds per feature
in the PR description so the review can measure it.

## When something fails

Fix the cause and run it again. After **three failures of the same thing**, stop that unit: write the blocker in
`decisions.md → Blocked` (what failed, last error, what each attempt changed), add a lesson to
`docs/engineering/lessons.md` if it teaches one, and continue with work that does not depend on it. Never weaken a
test, a scenario or a sensor to get past a failure. A blocked feature that blocks every remaining feature is an
escalation.

## Gray areas: conservative defaults

Answer from the PRD, the Design Doc, the ADRs and the brief. If a product question is still open, choose the option
that (1) adds no user-visible commitment the PRD does not make, (2) is reversible without a data migration, (3) is
stricter on safety and fairness, and (4) is the smallest scope that meets the exit criteria. Write it in the feature
PR's description under "Decisions", and add a row to `decisions.md → To confirm` when the maintainer should see it in
the review. If no option satisfies 1 and 2, escalate.

## KICKOFF — `/phase-kickoff F<n>`

1. Precondition: `phase-status F<n-1>` reports `closed`. Create `phase/F<n>` from `main` and push it.
2. Read the roadmap row (its requirements must all appear in the brief's "Covers"; `pnpm specs:check` enforces it once
   approved), the PRD and Design Doc sections the phase touches, the ADRs and the lessons.
3. Draft `.specs/phases/F<n>/brief.md` from `references/templates/brief.md`: goal, exit criteria with their proof,
   features (size, dependencies, parallelism, requirements covered), decisions already taken, what the runner needs
   from the maintainer, out of scope. Create `decisions.md` from its template and write `F<n>` to `ACTIVE`.
4. Commit, push, give the maintainer the link and stop. Their approval in their own words becomes
   `**Approved**: <date> - user: "<words>"` at the end of the brief, written only from their message.

## RUN — `/phase-run F<n>`

Start only when `phase-status` reports `run`. Loop: `phase-status` → for every runnable feature, do its next step →
repeat until nothing is runnable. Runnable features run in parallel.

1. **specify** — `.specs/features/<f>/spec.md`: user stories and EARS requirements with IDs (`<PREFIX>-01…`), each
   traced in `## Sources` to the PRD (`FR-xx`, `NFR-xx`) or an ADR; every requirement the brief assigns to the feature
   is covered. `acceptance.feature` next to it from `references/templates/acceptance.feature` (ADR 023): English
   Gherkin, one or more scenarios per requirement ID, tagged `@<ID>` and `@FR-xx`. Check with
   `node scripts/acceptance-check.mjs <f>`. No approval line: the brief's approval covers it.
2. **design** (Large or Complex only) — `design.md`: modules and layers touched, ports, contracts, data, telemetry, the
   ADRs it relies on. Short. A choice against an accepted ADR is an escalation; propose a new ADR instead.
3. **tasks** — `tasks.md` as a checklist, about 7 tasks per batch:

   ```markdown
   ## Batch 1

   - [ ] T1 — <what, in one line> — gate: `<command that proves it>`
   ```

   Run each gate command once before writing it (see lessons). Mutation never appears in a task gate (ADR 029).

4. **execute** — dispatch one `feature-worker` per feature with `isolation: "worktree"` and a prompt that names the
   feature, the batch, the phase branch and the feature branch `feat/<F>-<f>`. The worker checks out or creates that
   branch from `origin/phase/<F>`, implements the batch, ticks the boxes, makes one Conventional Commit per task and
   pushes the branch. Batches of one feature run one after another; different features run at the same time.
5. **pr** — open the PR into `phase/<F>` (`gh pr create --base phase/<F> --head feat/<F>-<f>`) with: what it does, the
   requirements it covers, "Decisions", how it was proven, fix rounds. Dispatch `architecture-reviewer` on the diff, and
   `security-reviewer` when the feature touches auth, sessions, the agent, pairing, secrets, uploads or the network
   edge. Fix findings that are bugs or rule violations (dispatch a fix batch); answer the rest in the PR. Wait for CI
   with `gh pr checks <pr> --watch` in the background. When the required checks are green, merge with
   `gh pr merge <pr> --merge` and delete nothing. A red check is a failure like any other (see above).

Only the feature's own scenarios run locally (`pnpm exec turbo run test:acceptance -- --grep @<PREFIX>-`); the full
acceptance suite, the load test and mutation run in CI or the nightly.

## REVIEW — `/phase-review F<n>`

When `phase-status` reports `review`: on `phase/<F>` run `pnpm check`, `pnpm quality:collect`,
`pnpm quality:ratchet --context phase`, and read the latest nightly run (mutation scores). Write `review.md` from
`references/templates/review.md` with real numbers and the command next to each: exit criteria with proofs, features
and PRs, decisions to confirm, blocked items, mutation and CI numbers, fix rounds per feature (H-001). Push, mark the
phase PR into `main` ready and stop. When the maintainer approves, write their approval line and merge the phase PR
with `gh pr merge <pr> --merge`.

## Escalations

See `references/escalation.md`: secrets and variables, the production database, repository settings and rulesets,
money, changing an accepted ADR, weakening a test or a sensor, a gray area with no conservative default, a blocked
feature that blocks the phase. Ask once, with 2 to 4 options and a recommendation, and continue with what does not
depend on the answer.

## Output

Plain, decided voice. Chat updates are one line each: feature, step, what is blocked. Content goes in the files and the
PR descriptions, not in chat.
