# Continuous Delivery Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only `scripts/lib/phase-state.mjs`, `scripts/phase-status.mjs`, `.claude/skills/d2rmm-phase-runner/**`, `.claude/commands/phase-*.md`, their tests and the acceptance steps change. No product code, contract, gate rule, `.claude/settings.json` or ruleset change.
- `phase-state.mjs` stays pure (ADR 024): `phase-status.mjs` reads files and git and passes evidence in.
- The `awaiting-review` expectations of `scripts/test/phase-state.test.mjs` change with CDL-07 (AD-168), a spec-driven change recorded in the spec; no other existing assertion changes.
- Tests that run git clear every `GIT_*` variable first and work only in temporary directories.
- Every gate runs through `node scripts/attempt.mjs run --feature continuous-delivery --step T<n> -- "<gate>"`, launched with this worktree as the working directory, with nothing outside the quotes.

---

**Design**: none - Medium feature; the placement is fixed in the rules above and in each task
**Status**: Approved
**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm lint; pnpm typecheck; pnpm test:harness`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (How to test, rules 3, 4 and 12), `docs/engineering/testing.md`, ADR 026.

| Code Layer                       | Required Test Type                             | Coverage Expectation                               | Location Pattern                                      | Run Command                                            |
| -------------------------------- | ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Phase state (pure)               | unit (`node --test`, evidence objects)         | CDL-04, CDL-07 to CDL-10, every edge case          | `scripts/test/phase-state.test.mjs`                   | `node --test scripts/test/phase-state.test.mjs`        |
| `phase-status` CLI               | harness (temporary repositories; not mutation) | CDL-09, CDL-17                                     | `scripts/test/phase-status-cli.test.mjs`              | `node --test scripts/test/phase-status-cli.test.mjs`   |
| Skill, commands and templates    | unit (`node --test`, reads the files)          | CDL-01 to CDL-06, CDL-11 to CDL-13, CDL-16, CDL-18 | `scripts/test/phase-runner-skill.test.mjs`            | `node --test scripts/test/phase-runner-skill.test.mjs` |
| The runner as it meets the state | acceptance (playwright-bdd)                    | Every scenario of `acceptance.feature`             | `tests/acceptance/steps/continuous-delivery.steps.ts` | `pnpm exec turbo run test:acceptance -- --grep @CDL-`  |

## Gate Check Commands

| Gate Level | When to Use         | Command                                               |
| ---------- | ------------------- | ----------------------------------------------------- |
| Quick      | Unit tasks          | the task's `node --test` command                      |
| Full       | The acceptance task | `pnpm exec turbo run test:acceptance -- --grep @CDL-` |
| Build      | After the last task | `pnpm lint; pnpm typecheck; pnpm test:harness`        |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Phase state

```
T1 → T2 → T3
```

### Phase 2: Guides and templates

```
T3 → T4 → T5
```

### Phase 3: Scenarios

```
T5 → T6
```

---

## Task Breakdown

### T1: Maintainer items in the phase state

**What**: In `scripts/lib/phase-state.mjs`, `maintainerItems(decisionsText)` reads the `## For the maintainer` table of `decisions.md` (columns Feature, Item, Asked, Answer) into `{ feature, item, open }`, `open` when the Answer cell is empty or holds only spaces; `derivePhaseState` takes `ev.decisions` (the text, or null), marks a feature with an open item `blocked` with `reason: 'maintainer'` and lists its open items in `items`, leaves its dependents `waiting` through the existing rule, and puts items whose feature is not in the brief in `state.phaseItems`.
**Where**: `scripts/lib/phase-state.mjs` (modify)
**Depends on**: None
**Reuses**: `briefFeatures` (table parsing), `derivePhaseState`
**Requirement**: CDL-08, CDL-09, CDL-10

**Done when**:

- [x] An open item blocks its feature with the reason `maintainer`; a dependent is `waiting`; an independent feature keeps its state (test `an open maintainer item blocks only its feature`)
- [x] A filled Answer clears the item; an Answer of spaces does not (test `an answered maintainer item no longer blocks`)
- [x] Two items of one feature are both listed; an item for a feature not in the brief lands in `phaseItems` (test `lists open maintainer items by feature`)
- [x] No table, or `ev.decisions` null, changes nothing (test `no maintainer table changes nothing`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-state.test.mjs`

**Commit**: `feat(harness): block a feature on an open maintainer item`

---

### T2: The phase closes without a review approval

**What**: In `scripts/lib/phase-state.mjs`, drop `awaiting-review` from `PHASE_STEPS` and from `derivePhaseState`: with every feature done or blocked, no `review.md` → `review`; a `review.md` → `merge` until `ev.mergedToMain`, then `closed`, whatever approval lines the review holds (CDL-07, AD-168). The `awaiting-review` expectations of `phase-state.test.mjs` become `merge` (spec-driven, recorded in the spec). A unit test pins CDL-04's reading: a feature whose verification commit reaches the phase only through a merge commit is `done`; one squashed into a commit with no trailers is `integrate`.
**Where**: `scripts/lib/phase-state.mjs` (modify)
**Depends on**: T1
**Reuses**: `derivePhaseState`, `merged`
**Requirement**: CDL-04, CDL-07

**Done when**:

- [x] No review → `review`; a review with or without an approval line → `merge`; merged into main → `closed` (test `closes on the review and the merge, with no approval line`)
- [x] `awaiting-review` appears nowhere in `PHASE_STEPS` (test `has no awaiting-review step`)
- [x] Merge commit → `done`; squash with no trailers → `integrate` (test `integrates only when the trailers reach the phase`)
- [x] Every other existing test of `phase-state.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-state.test.mjs`

**Commit**: `feat(harness): close a phase on its review and its merge`

---

### T3: phase-status reads origin/main and prints maintainer items

**What**: In `scripts/phase-status.mjs`, `mergedToMain` is true when `phase/F<n>` is an ancestor of `main` or of `origin/main` (CDL-17); it reads `.specs/phases/<F>/decisions.md` into `ev.decisions`; the text output prints each open maintainer item under its feature's line and `phaseItems` under the phase line (CDL-09); `--json` carries `reason`, `items` and `phaseItems`. `scripts/test/phase-status-cli.test.mjs` runs the CLI against temporary repositories (with every `GIT_*` variable cleared).
**Where**: `scripts/phase-status.mjs` (modify)
**Depends on**: T2
**Reuses**: `derivePhaseState`, `maintainerItems` (T1)
**Requirement**: CDL-09, CDL-17

**Done when**:

- [x] A phase branch merged only into `origin/main` (a local `main` behind it) reports `closed` (test `reads a merge on origin/main`)
- [x] Open items print on their feature's line and on the phase line; `--json` carries them (test `prints open maintainer items`)
- [x] Gate passes

**Tests**: harness (spawns the CLI; not a mutation proof)
**Gate**: `node --test scripts/test/phase-status-cli.test.mjs scripts/test/phase-state.test.mjs`

**Commit**: `feat(harness): phase-status reads origin/main and shows maintainer items`

---

### T4: The skill and commands tell the remote flow

**What**: `.claude/skills/d2rmm-phase-runner/SKILL.md` and `.claude/commands/phase-kickoff.md`, `phase-run.md`, `phase-review.md` describe: kickoff pushes `phase/F<n>` and opens a draft phase PR (CDL-01); after verification the runner pushes the feature branch and opens a PR into the phase (CDL-02); integration is local `pnpm check`, the feature's own scenarios (`--grep @<PREFIX>-`) and the PR's required checks, never the full acceptance, load or full mutation locally (CDL-03, CDL-18); `gh pr merge --merge`, never squash or rebase (CDL-04); waiting runs `gh pr checks <pr> --watch` as a background task (CDL-05); the review merges the phase PR when its gates and the four ADR 028 § 2 checks pass, else records why (CDL-06, AD-170); items ADR 028 § 1 keeps with the maintainer become rows of `decisions.md → For the maintainer` and the runner continues with independent features (CDL-16). The phrases "leave it ready and list it in the review" and "the exact commands the maintainer runs to push and open the PR" are gone. `phase-runner-skill.test.mjs` checks each, with whitespace normalised.
**Where**: `.claude/skills/d2rmm-phase-runner/SKILL.md`, `.claude/commands/phase-kickoff.md`, `.claude/commands/phase-run.md`, `.claude/commands/phase-review.md`, `scripts/test/phase-runner-skill.test.mjs`
**Depends on**: T3
**Reuses**: the existing checks of `phase-runner-skill.test.mjs`
**Requirement**: CDL-01, CDL-02, CDL-03, CDL-04, CDL-05, CDL-06, CDL-13, CDL-16, CDL-18

**Done when**:

- [x] Each instruction is found in the skill and its command (test `the skill tells the remote flow`)
- [x] The two old phrases are absent, whitespace normalised (test `the skill no longer leaves delivery to the maintainer`)
- [x] Every existing test of `phase-runner-skill.test.mjs` passes unchanged
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs`

**Commit**: `docs(harness): the phase runner delivers through pull requests`

---

### T5: Templates

**What**: `references/templates/brief.md` gains a "Delivery" section describing the remote flow (CDL-01 to CDL-06, CDL-16); `references/templates/review.md` drops the section of commands the maintainer runs to push and open the PR (CDL-12); `references/templates/decisions.md` gains the `## For the maintainer` table (Feature, Item, Asked, Answer). `phase-runner-skill.test.mjs` checks the three.
**Where**: `.claude/skills/d2rmm-phase-runner/references/templates/brief.md`, `review.md`, `decisions.md`, `scripts/test/phase-runner-skill.test.mjs`
**Depends on**: T4
**Reuses**: the template checks of `phase-runner-skill.test.mjs` (HBS-24)
**Requirement**: CDL-11, CDL-12

**Done when**:

- [x] The brief template has the Delivery section; the review template has no push-commands section; the decisions template has the maintainer table (test `the templates tell the remote flow`)
- [x] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs`

**Commit**: `docs(harness): templates for the remote flow`

---

### T6: Scenarios

**What**: `tests/acceptance/steps/continuous-delivery.steps.ts`: the steps of every scenario of `acceptance.feature`, black box, running `scripts/phase-status.mjs` of this checkout as a child process against a temporary repository built per scenario (every `GIT_*` variable cleared): a brief listing "alpha", "beta" and "gamma" after "alpha", feature files and trailer commits to reach each state, merge and squash histories, `origin/main` as a ref, a `decisions.md` with the maintainer table.
**Where**: `tests/acceptance/steps/continuous-delivery.steps.ts`
**Depends on**: T5
**Reuses**: the temporary-repository helpers of `harness-bootstrap.steps.ts` where they fit
**Requirement**: CDL-04, CDL-07, CDL-08, CDL-09, CDL-10, CDL-17

**Done when**:

- [x] Every scenario of `acceptance.feature` passes
- [x] `pnpm test:harness` and `pnpm contracts:check` pass with no test removed or skipped (CDL-14, CDL-15)
- [x] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @CDL- && pnpm test:harness && pnpm contracts:check`

**Commit**: `test(harness): acceptance steps for continuous delivery`

---

## Checks

**C1** - Kickoff pushes the phase branch and opens a draft phase PR (CDL-01)
Proof: `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C2** - Each verified feature is pushed with a PR into the phase; integration is local check, own scenarios and required checks; nothing full runs locally (CDL-02, CDL-03, CDL-18)
Proof: `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C3** - A feature is integrated only when its trailers reach the phase; the runner merges with `--merge` (CDL-04)
Proof: `node --test --test-name-pattern "integrates only when the trailers reach the phase" scripts/test/phase-state.test.mjs`

**C4** - The runner waits on `gh pr checks --watch` in the background (CDL-05)
Proof: `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C5** - The phase PR merges only on the review's gates and the four checks (CDL-06)
Proof: `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C6** - A review moves the phase to `merge`, the merge to `closed`, with no approval line (CDL-07)
Proof: `node --test --test-name-pattern "closes on the review and the merge, with no approval line" scripts/test/phase-state.test.mjs`

**C7** - An open maintainer item blocks only its feature (CDL-08)
Proof: `node --test --test-name-pattern "an open maintainer item blocks only its feature" scripts/test/phase-state.test.mjs`

**C8** - Open items print on their feature's line and the phase line (CDL-09)
Proof: `node --test --test-name-pattern "prints open maintainer items" scripts/test/phase-status-cli.test.mjs`

**C9** - An answered item no longer blocks; a blank one does (CDL-10)
Proof: `node --test --test-name-pattern "an answered maintainer item no longer blocks" scripts/test/phase-state.test.mjs`

**C10** - The templates tell the remote flow (CDL-11, CDL-12)
Proof: `node --test --test-name-pattern "the templates tell the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C11** - The skill no longer leaves delivery to the maintainer (CDL-13)
Proof: `node --test --test-name-pattern "the skill no longer leaves delivery to the maintainer" scripts/test/phase-runner-skill.test.mjs`

**C12** - The harness suite passes with nothing removed or skipped (CDL-14)
Proof: `pnpm test:harness`

**C13** - No contract drift (CDL-15)
Proof: `pnpm contracts:check`

**C14** - Maintainer items become table rows and the runner continues (CDL-16)
Proof: `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`

**C15** - A merge on `origin/main` closes the phase (CDL-17)
Proof: `node --test --test-name-pattern "reads a merge on origin/main" scripts/test/phase-status-cli.test.mjs`

**C16** - Every scenario passes (CDL-04, CDL-07 to CDL-10, CDL-17)
Proof: `pnpm exec turbo run test:acceptance -- --grep @CDL-`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-1 (T1 to T6) to `feature-worker` at the commit of this line, 2026-11-08
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 → T2 → T3
Phase 2:  T3 → T4 → T5
Phase 3:  T5 → T6
```

Batches: `execute-batch-1` runs phases 1 to 3 (T1 to T6).
