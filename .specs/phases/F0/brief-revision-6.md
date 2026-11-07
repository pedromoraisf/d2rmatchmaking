# Phase F0 — Brief revision 6

**Status**: APPROVED — revision approved and ADR 028 accepted by the maintainer on 2026-11-07.
**Why**: the F0 retrospective (2026-11-07) found that an agent was working in 57.3 h of the phase's 200.8 h. Most of the
rest was the harness waiting for the maintainer or for itself. The maintainer asked for every recommendation of that
retrospective to be implemented as pre-work before F1, in their words: "sobre a recomendação que fez, quero que
planeje tudo para ser implementado no repositorio", "priorize as mudanças que removem friccoes do seu desenvolvimento,
e aumentem a sua celeridade", "não vamos incorporar isso na fase 1. esse sera um pre work para iniciar a fase 1". F0
closes after this revision; F1 starts on the new harness.

## Decisions this revision rests on

Taken by the maintainer on 2026-11-07, recorded as AD-138 to AD-142 in `.specs/STATE.md` and in ADR 028 (Proposed):

| Decision                          | Maintainer's choice                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Push, merge and the delivery flow | "push, merge, etc etc, não precisa ser mais meu. pode fazer sem precisar pedir aprovacao, ou que eu fale que queira que voce faça"            |
| How far that goes                 | The whole delivery flow. Secrets, the production database, repository settings and rulesets, and money stay the maintainer's.                 |
| Edits to the gate itself          | Allowed without asking under a guard: a new `harness-self` scope, harness tests green and a `security-reviewer` PASS on the diff before merge |
| Retry-budget resets               | Environment failures and unchanged reruns stop counting; the orchestrator may reset each unit once, with a reason; a second reset is theirs   |
| Where this work runs              | As this revision of F0, run by the phase runner under the current delegation                                                                  |

## 1. New feature rows

Ordered by the friction each removes. Rows 2 to 4 run in parallel, in separate worktrees; they touch disjoint files
(see each scope).

| Feature              | Size   | Depends on                      | Parallel                          | Covers                          | Wall-clock |
| -------------------- | ------ | ------------------------------- | --------------------------------- | ------------------------------- | ---------- |
| harness-bootstrap    | Small  | room-trace-link                 | no (first)                        | NFR-11, ADR 021/022/028         | default    |
| gate-precision       | Large  | harness-bootstrap               | with budget-v2, ci-fast-path      | NFR-11, ADR 019/028             | default    |
| budget-v2            | Medium | harness-bootstrap               | with gate-precision, ci-fast-path | NFR-11, ADR 022/028             | default    |
| ci-fast-path         | Medium | harness-bootstrap               | with gate-precision, budget-v2    | NFR-10, NFR-11, ADR 014/026/028 | default    |
| continuous-delivery  | Medium | harness-bootstrap, ci-fast-path | no                                | NFR-11, ADR 021/024/028         | default    |
| fast-proofs          | Medium | budget-v2, continuous-delivery  | no                                | NFR-11, ADR 022/023             | default    |
| parallel-cloud-spike | Small  | continuous-delivery             | no (last)                         | NFR-11, ADR 021/025             | default    |

### What each row removes (measured in F0)

| Friction in F0                                                          | Measured                                                          | Row                  | Target                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| Asks for push, PR merge, merge into `main`, releases, deploys           | 49 asks                                                           | harness-bootstrap    | 0                                                |
| Every edit to the gate asks, with no delegation possible                | 25 asks; a harness feature cannot run unattended                  | harness-bootstrap    | 0 inside `harness-self` features                 |
| Permission prompts for read-only shell commands                         | 89 prompts, 15.7 h waiting (one reviewer waited 6 h)              | gate-precision       | 0                                                |
| "Shell write to a harness/sensor file" on reads (`2>&1`, `2>/dev/null`) | 70 of 83 such asks were reads                                     | gate-precision       | 0 false positives                                |
| Asks for scripts outside the repo, gate errors                          | ~25 asks, 8 "Invalid string length" errors                        | gate-precision       | judged by content; no size errors                |
| Gate timeouts                                                           | 44 timeouts at 15 s                                               | gate-precision       | cold start p95 ≤ 300 ms                          |
| Polling and `sleep` while waiting for gates and CI                      | 7.9 h; one worker made 1,204 status checks in 76 min              | gate-precision       | denied; agents wait for the task notification    |
| Retry-budget resets by the maintainer                                   | 34 messages, 5.9 h of pauses before them                          | budget-v2            | only a unit's second reset                       |
| New sessions to get past an exhausted one                               | 30 `/phase-run` restarts, 9.2 h of pauses before them             | budget-v2            | fewer exhausted sessions (env failures excluded) |
| Wrapper denials                                                         | 103 "quote the whole gate command", 79 "only through the wrapper" | budget-v2            | read-only filters allowed; fix in the message    |
| PR CI critical path                                                     | 14.9 min, of which Stryker 7.7 blocks `integration`               | ci-fast-path         | ≤ 8 min                                          |
| Mutation in the local task loop                                         | 3.0 h                                                             | ci-fast-path         | Verifier, PR job and nightly only                |
| CI sees the code at the end of the phase                                | first CI on day 6; last mile 58.7 h for 6.5 h of work             | continuous-delivery  | CI on every feature PR                           |
| Proof reruns                                                            | 65 `check_proofs` runs, 8.9 h                                     | fast-proofs          | ≤ 2 official runs per feature                    |
| No parallel work                                                        | 1.7 h with two or more agents active, of 57.3 h                   | parallel-cloud-spike | measured trial and ADR draft                     |

## 2. Order and the bootstrap

`harness-bootstrap` runs first and alone. It changes the gate before the gate knows `harness-self`, so its edits to
`.claude/hooks/**` still ask the maintainer (an estimated 10 to 20 approvals, one sitting). The maintainer is present
for its one execute batch, and their approvals stand in for the guard this row creates. It merges into `phase/F0` before
any other row starts: the hooks run from the main checkout, so the new rules apply to everything after the merge.
From then on no row is expected to ask, except the items listed in section 6.

## 3. Scope of each feature (sketch for its Specify; the runner writes the requirement IDs)

### harness-bootstrap

- **Delivery per ADR 028**: the gate answers `allow` for `git push` (never `-f`, `--force*`, `--mirror`, `--delete`,
  `+refspec`), `gh pr create|edit|ready|comment|merge` (merge method `merge` only), `gh release create|edit|upload`,
  `git tag`, `gh workflow run`, `gh run rerun`, and the Render deploy hook. It still asks for `gh secret`,
  `gh variable set`, `wrangler secret`, and `gh api` calls that change rulesets, environments or repository settings.
  It still denies force push, remote deletion, `--no-verify`, the production database and `gh repo delete|archive|edit`.
- **`harness-self` scope**: a fifth delegation scope in `.claude/hooks/lib/delegation.mjs` and the brief template.
  With it ticked, edits to the self-protected files are allowed in the worktree of a feature listed under the scope,
  never in the main checkout.
- **The guard**: merging a `harness-self` feature (local `git merge` or `gh pr merge`) is refused until
  `pnpm test:harness` has passed through `attempt.mjs` at the feature's head and a `security-reviewer` `review-diff`
  verdict of PASS is recorded at the same head. The verdict is recorded by a hook from the reviewer's transcript; the
  orchestrator has no way to write it. Design confirms what the SubagentStop hook input carries for this.
- **Texts**: `AGENTS.md` rules 7 and 8 and the "Phase workflow" escalation item, `CLAUDE.md`, the phase-runner
  `SKILL.md` lines that say "never push", `references/escalation.md`. The runner's new flow itself is
  `continuous-delivery`.

### gate-precision

Files: `.claude/hooks/lib/gate-rules.mjs`, `shell-indirection.mjs`, `gate.mjs`, `io.mjs` and their tests.

- **Allow what is provably read-only**, so Claude Code never prompts for it: `cat`, `sed -n`, `grep`, `rg`, `head`,
  `tail`, `wc`, `ls`, `find` without `-exec`, `-delete` or `-fprint`, `jq`, `awk` without `system(` or output
  redirection, `diff`, `git status|diff|log|show|branch|rev-parse|ls-files|fetch`, `gh run|pr view|list|checks|diff`,
  `gh api` GET, `node scripts/phase-status.mjs`, `attempt.mjs status|report`, joined by `cd <dir> &&`, pipes, `echo`,
  `2>&1` and redirections to `/dev/null`. Anything else keeps today's path.
- **Parse redirections**: a shell write is a redirection, `tee`, `sed -i`, `cp`, `mv` or `truncate` whose target is a
  file. `/dev/null` and `&1`/`&2` are not targets, and a `>` inside quotes is not a redirection. A real shell write to
  a protected file is denied with the instruction to use the Edit tool, instead of asking.
- **Inline code** (`python3 - <<`, `node -e`) that writes a protected file: denied with the same instruction.
- **Scripts outside the repository** (the session scratchpad) are read and judged by their content; the gate asks only
  when it cannot read them. Tokens that are not paths (`//`, `/**`, regular-expression text) are never scripts.
- **Sensor help is not a sensor run**: `--help`, `-h`, `--version` and `--list` on a sensor are allowed on phase and
  feature branches.
- **No polling**: deny `sleep` longer than 30 s, `until`/`while` loops that sleep, and the fifth identical command
  within 10 minutes in one session. The reason tells the agent to run long work in the background and wait for its
  task notification. `feature-worker.md` and the phase-runner skill say the same.
- **Robust and fast**: no input size makes the gate throw; heavy modules load only for the rules that need them; cold
  start p95 ≤ 300 ms over the replay corpus.
- **Replay corpus**: `scripts/test/fixtures/gate-replay.json`, the F0 commands that prompted or were denied, with paths
  normalised and nothing secret (secretlint passes), each with its expected decision under ADR 028. The test is the
  proof that the asks above are gone.

### budget-v2

Files: `scripts/lib/budget.mjs`, `scripts/attempt.mjs`, `.claude/hooks/lib/budget-rules.mjs`, `stop.mjs` and their
tests, `references/retry-budget.md`, `AGENTS.md` rule 11.

- **Environment failures**: `attempt.mjs` classifies a failure as environmental when its output matches a fixed,
  tested signature list (Docker daemon unreachable, `ENOSPC`, exit 137 or SIGKILL, `EADDRINUSE`, a missing toolchain
  binary, the wrapper's timeout). It is recorded, not counted. Three in a row block the unit as `env-blocked`, with a
  diagnosis (free memory, swap, load, running containers, leftover acceptance stacks), and the runner escalates the
  machine.
- **Unchanged reruns**: when the content of the paths the feature touches is the same as at the unit's last failure,
  `run` refuses without running or counting and says so.
- **Orchestrator reset**: `attempt.mjs reset --unit <key> --by orchestrator --reason "<why>"` is allowed once per unit;
  the second asks the maintainer. `ledger.resets` and `attempt.mjs report` show every reset with its reason.
- **Wrapper output**: the full output goes to `reports/attempts/<unit>/<n>.log`; the terminal gets the result, the
  duration and the last 60 lines. Read-only filters after the wrapper (`2>&1 | tail -n N`, `| head`, `| grep`) are
  allowed; any other chained command is still denied. Every wrapper denial carries the corrected command, ready to run.
- `MAX_RETRIES = 2` does not change.

### ci-fast-path

Files: `.github/workflows/*.yml`, `.github/rulesets/main.json`, `.github/dependabot.yml`, `scripts/lib/specs.mjs`,
the workflow tests under `scripts/test/`.

- **Mutation leaves `verify`**: a new `mutation` job in `ci.yml` needs `detect` only, runs in parallel, is not a
  required check, mutates only the changed files under the API's `domain` and `application` layers (from the PR's diff),
  and keeps `reports/stryker-incremental-*.json` in `actions/cache` keyed on the base branch. Survivors go to the job
  summary. `integration` starts when the fast `verify` ends.
- **Agent mutation**: a non-required PR job runs `cargo mutants --in-diff` when `apps/agent/src-tauri` changes. The
  nightly agent mutation moves to `ubuntu-latest` if the three crates build there (Design checks the adapters crate).
- **Mutation leaves the task loop**: a task's `Gate` in `tasks.md` may not run `test:mutation` or `cargo mutants`
  (`pnpm specs:check` fails on it). Mutation runs in the Verifier, the PR job and the nightly; the phase ratchet reads
  the nightly report.
- **Required checks**: `.github/rulesets/main.json` requires `verify`, `integration`, `agent` and `secrets`. Applying
  the ruleset on GitHub is the maintainer's (section 6).
- **Pre-merge smoke checks**, not required at first: build the API for production, run its migrations against a
  Postgres service container and call `GET /healthz`; `tauri build` without signing when `apps/agent` changes.
- **Dependabot**: semver-major updates of `eslint*` and `@opentelemetry/*` move to a monthly group; minor and patch
  stay weekly.

### continuous-delivery

Files: `.claude/skills/d2rmm-phase-runner/**`, `.claude/commands/phase-*.md`, `scripts/phase-status.mjs`,
`scripts/lib/phase-state.mjs` and their tests.

- **Kickoff**: the runner pushes `phase/F<n>` and opens a draft PR to `main`, so CI runs from the first feature.
- **Each feature**: the runner pushes `feat/F<n>-<feature>` and opens a PR into `phase/F<n>`. Integration is local
  `pnpm check`, the feature's own acceptance scenarios (`--grep` its requirement IDs) and the PR's required checks
  green; then `gh pr merge --merge`, which keeps the progress trailers. Full acceptance, load and full mutation run in
  CI, not on the 8 GB machine.
- **Waiting for CI**: `gh pr checks --watch` in the background; the runner continues on its notification.
- **Phase end**: `/phase-review` writes `review.md`; when its gates are green the runner marks the phase PR ready and
  merges it into `main`. `phase-status` reports `closed` when the phase PR is merged and the review exists; the
  maintainer reads the review afterwards, and anything sent back becomes a follow-up feature.
- **What still needs the maintainer** (section 6 and ADR 028) goes to `decisions.md → For the maintainer`, shown once
  per feature, and blocks only the feature that needs it.
- Templates: the brief gains the `harness-self` scope and the remote flow; the review drops "commands the maintainer
  runs to push".

### fast-proofs

Files: `scripts/proofs-preflight.mjs` (new), its test, the phase-runner skill's Verify step.

- `node scripts/proofs-preflight.mjs <feature>` runs the proofs listed in `tasks.md ## Checks`, caching each green proof
  under a key made of its command and the content of the files the feature changed. It reruns only proofs that failed
  or whose key changed, and prints which ran.
- The fix loop uses preflight. The official `check_proofs.py` (vendored, unchanged) runs once, as step `proofs`, when
  preflight is green.

### parallel-cloud-spike

- Run one small feature in a Claude Code cloud session: check Docker and Testcontainers, Playwright, cargo and the
  hooks there, and time each gate against this machine.
- Output: a measured note in `docs/engineering/` and a Proposed ADR on running independent features in parallel
  sessions. No change to the runner in this revision.

## 4. Exit criteria added to F0

- [ ] Replaying the F0 command corpus through the gate gives `allow` for read-only commands and for push, PR, merge,
      release and workflow commands, and `ask` only for secrets, repository settings and the other maintainer items of
      ADR 028 — proof: `pnpm test:harness` (gate replay test)
- [ ] An environment failure and an unchanged rerun leave a unit's failure count as it was; the orchestrator's first
      reset of a unit runs and the second asks — proof: budget and attempt CLI tests
- [ ] A `harness-self` feature cannot merge without its recorded `security-reviewer` PASS at its head — proof: gate
      test
- [ ] The median PR CI critical path is at most 8 minutes over the first five PR runs after `ci-fast-path` — proof: run
      ids in the review
- [ ] The rows after `harness-bootstrap` merge through PRs the runner pushed and merged, with required checks green —
      proof: PR links
- [ ] Preflight reruns only proofs that failed or whose inputs changed — proof: preflight test

## 5. Delegation

Unchanged for the four existing scopes. When `harness-bootstrap` has merged, `brief.md`'s `## Delegation` gains:

- [ ] harness-self: edit the gate, its registration and the retry-budget code in `gate-precision`, `budget-v2`,
      `continuous-delivery` and `fast-proofs`, under the guard of ADR 028

The box is ticked by the maintainer's approval of this revision.

## 6. For the maintainer

- Accept ADR 028 and approve this revision (one message is enough).
- Be present for `harness-bootstrap`'s execute batch: 10 to 20 permission prompts for edits to `.claude/hooks/**`.
- After `ci-fast-path` merges, apply the ruleset on GitHub (a repository setting):
  `gh api -X PUT repos/pedromoraisf/d2rmatchmaking/rulesets/<main-ruleset-id> --input .github/rulesets/main.json`.
- Nothing else is expected. Secrets, the production database, repository settings and money stay yours whenever they
  come up.

## 7. Out of scope

- Any F1 product work.
- Changing `MAX_RETRIES`, the roles and models of ADR 025, or the TLC method. The vendored skill stays unmodified.
- Running the phase runner headless in GitHub Actions (ADR 021 says it needs a paid API key and its own ADR).
- Automatic resume after a subscription session limit: the spike records whether cloud sessions make it possible.

## Approval

**Approved**: 2026-11-07 - user: "Aprovo a revisão do ADR 028."
