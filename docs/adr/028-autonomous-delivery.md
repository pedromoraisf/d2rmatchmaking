# ADR 028 — Autonomous delivery and a self-maintained harness

**Status**: Proposed
**Date**: 2026-11-07
**Deciders**: maintainer
**Supersedes**: in part ADR 021 (the escalation list: push, merges, deploys, releases, tags) and ADR 022 (who resets a
retry budget and what counts as a failure)

## Context

The F0 retrospective (2026-11-07) measured 200.8 h of calendar for the phase. An agent was working in 57.3 h of it. The
rest was waiting for the maintainer: 47.1 h of pauses up to 3 h and 96.3 h of longer absences. The largest causes were
in the harness itself:

- 399 permission prompts. 89 were read-only shell commands (15.7 h of waiting) and 59 were reads that the gate mistook
  for shell writes to protected files (70 of the gate's 83 "Shell write to a harness/sensor file" asks matched a `>` in
  `2>&1` or `2>/dev/null`). A design reviewer waited 6 h for the approval of a `sed -n`.
- 34 maintainer messages that only reset a retry budget, many after failures caused by the machine (Docker stopped, an
  8 GB machine saturated, PATH), and 30 new `/phase-run` sessions to get past an exhausted one.
- `git push` was an escalation, so the phase code first reached CI on its sixth day. The last mile, from the PR to
  production, took 58.7 h of calendar for 6.5 h of agent work, and every CI-only defect surfaced in it.
- Every edit to `.claude/hooks/**` and `.claude/settings.json` asks the maintainer, with no delegation possible, so a
  harness change cannot run unattended.

On 2026-11-07 the maintainer decided: "push, merge, etc etc, não precisa ser mais meu. pode fazer sem precisar pedir
aprovacao, ou que eu fale que queira que voce faça". Asked how far that goes, the maintainer chose, in the same session:
the whole delivery flow; gate self-edits allowed with a guard; one orchestrator reset per retry-budget unit.

## Decision

### 1. Delivery is the runner's

The runner pushes, opens pull requests, merges them (into phase branches and into `main`, the phase PR included),
creates releases and tags, runs and reruns workflows, and lets the deploys that follow a merge happen. It does so when
its own gates say so, without asking and without being told to. The gate hook answers `allow` for these commands.

Still denied, as before: force push, deleting remote branches or tags, `--no-verify` and any way of disabling Lefthook,
and the production database connection string.

Still the maintainer's (the gate asks):

- creating or changing secrets and variables (GitHub, Cloudflare, Render, Neon);
- repository settings, rulesets and environments, including applying `.github/rulesets/*.json`;
- anything that costs money;
- approving a phase brief or a brief revision, and accepting or superseding an ADR;
- deleting, skipping or weakening tests, loosening a sensor, a threshold or the quality baseline;
- a retry-budget reset beyond the orchestrator's one per unit (section 4).

The phase review (`review.md`) stays, but it no longer gates the merge to `main`: the runner merges the phase PR when
the review's own gates are green, and the maintainer reads the review afterwards. Anything the maintainer sends back
becomes a follow-up feature.

### 2. Required checks are the safety net

With merges autonomous, the ruleset's required status checks are the only lock before `main`. `main` requires `verify`,
`integration`, `agent` and `secrets`. Mutation testing runs as a separate, parallel PR job that is not required; the
nightly full run and the phase ratchet hold its score (ADR 014, ADR 026).

### 3. The harness may maintain itself, under a guard

A new delegation scope, `harness-self`, lets the runner edit the self-protected files (`.claude/settings.json`,
`.claude/hooks/**`, the ratchet and retry-budget libraries, `scripts/attempt.mjs` and their tests) without asking, in
the worktree of a feature the approved brief lists under that scope, never in the main checkout. Such a feature merges
only when `pnpm test:harness` passed through the retry-budget wrapper and a `security-reviewer` returned `VERDICT:
PASS` on the feature's diff at its head commit. The hooks record that verdict from the reviewer's own transcript, so the
orchestrator cannot write it. The maintainer sees every such change in the phase review.

### 4. The retry budget counts what the agent controls

`MAX_RETRIES = 2` is unchanged. Three things change:

- A failure whose output matches a fixed list of environment signatures (the Docker daemon unreachable, no space left,
  a process killed by the out-of-memory killer, a port already in use, a missing toolchain binary, the wrapper's own
  timeout) is recorded but not counted. Three environment failures in a row block the unit as an environment problem,
  with a diagnosis of the machine, and the runner escalates the machine, not the code.
- Running a unit again with nothing changed since its last failure is refused without running or counting.
- The orchestrator may reset each unit once, with a reason that the ledger and the phase review keep. A second reset of
  the same unit is the maintainer's.

## Alternatives considered

- **Keep delivery as an escalation and batch the asks per feature.** Fewer interruptions, but CI would still see the
  code late and the maintainer would still be the merge queue.
- **Push and PRs autonomous, merge to `main` the maintainer's.** Keeps one human gate on `main`, at the cost of the
  last mile staying human-paced. The maintainer chose the whole flow.
- **Keep asking for every gate self-edit.** Safe, but a harness feature could only run with the maintainer present.
- **Unguarded self-edits.** Rejected: the gate would be the only sensor no independent agent reviews.
- **The orchestrator resets freely, every reset logged.** Rejected: the budget would stop being a limit.

## Consequences

- The maintainer leaves the delivery loop. The required checks, the gates and the reviewers carry what the push and
  merge prompts used to.
- A defect that only CI finds surfaces on the feature's PR, not after the phase.
- A weakened gate is possible only through a reviewed, tested change that the phase review lists.
- Budget numbers in reviews change meaning: environment failures and refused unchanged reruns are listed apart.
- `AGENTS.md` rules 7, 8 and 11, `CLAUDE.md`, the phase-runner skill and its escalation and retry-budget references
  change with this ADR. TLC's vendored blast-radius rule stays as written; `AGENTS.md` overrides it for this project.
- Revisit after F1: count the asks left, the CI time and the resets.
