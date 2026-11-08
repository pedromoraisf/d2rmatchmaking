# Harness Bootstrap Specification

**Approved**: 2026-11-07 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

**Amended by the runner** (assumed, AD-147; to confirm at the phase review): 2026-11-07, Execute found that HBS-47 as written denies a `git merge` or `gh pr merge` of any branch the main checkout has not fetched, even when no feature is covered and there is nothing to guard. HBS-47 applies while the brief covers at least one feature; while it does, every unresolvable operand is denied, whatever its name. No criterion is edited and no requirement is added.

## Problem Statement

In F0 the gate asked the maintainer 49 times for push, PR merges, merges into `main`, releases and deploys, and 25 times
for edits to the gate itself, which no delegation could cover. ADR 028 (accepted 2026-11-07) makes delivery the
runner's and lets the harness maintain itself under a guard. The gate still enforces ADR 021's list, so nothing after
this row can run unattended until the gate knows the new rules. This row changes the gate first, with the maintainer
present for its edits, so every later row of brief revision 6 runs on the new rules. Source:
`.specs/phases/F0/brief-revision-6.md` § 2 and § 3, approved by the maintainer on 2026-11-07.

## Goals

- [ ] Push, PR, merge, release, tag and workflow commands of the exact shapes below reach the gate and come back
      `allow`; every other shape keeps the decision it gets today or a stricter one.
- [ ] Secrets, repository settings, the production database and destructive remote operations keep the decisions ADR
      028 gives them, and no allowed shape reaches `main` around a pull request.
- [ ] A feature listed under `harness-self` edits the gate in its own worktree without asking, and no git command
      brings its commits into another branch except a merge of its proven head.
- [ ] `AGENTS.md`, `CLAUDE.md`, the phase-runner skill and its escalation reference say what ADR 028 says.

## Out of Scope

| Feature                                                                                           | Reason                                                                                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Allowing read-only shell commands, redirection parsing, polling limits, gate speed                | `gate-precision`, brief revision 6                                                                             |
| Environment failures, unchanged reruns, orchestrator resets, wrapper output                       | `budget-v2`, brief revision 6                                                                                  |
| The runner's remote flow: pushing branches, opening PRs and merging them as steps of `/phase-run` | `continuous-delivery`, brief revision 6                                                                        |
| Ticking `harness-self` in `brief.md`'s `## Delegation`                                            | The orchestrator does it after this row merges (§ 5)                                                           |
| Applying `.github/rulesets/*.json` on GitHub                                                      | A repository setting; the maintainer's (ADR 028 § 1)                                                           |
| Copying a covered feature's content by hand, without git (retyping it in an Edit)                 | An Edit of a self-protected file outside a covered worktree already asks (HBS-22); no ref is involved to guard |
| Editing `.claude/skills/tlc-spec-driven/**`                                                       | Vendored (AGENTS.md, "Never do")                                                                               |
| Changing `MAX_RETRIES`, the roles and models of ADR 025                                           | Out by brief revision 6 § 7                                                                                    |
| Any product behaviour: API, site, agent or contract changes                                       | The row changes harness files and their tests only                                                             |

---

## Assumptions & Open Questions

| Assumption / decision                              | Chosen default                                                                                                                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                               | Confirmed?          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Where the reviewer's verdict is read               | The gate notes the branch head when a foreground `security-reviewer` dispatch with step `review-diff` starts; a `PostToolUse` hook on the `Agent`/`Task` tool reads the report text from `tool_response` when it returns, and records the verdict at the noted head. A background dispatch is denied. An unreadable response records a FAIL | `PreToolUse` and `PostToolUse` carry the tool's input, `tool_use_id` and response, written by Claude Code, not the orchestrator. A background dispatch returns before the verdict exists. If the payload is not what is assumed, the guard fails closed | n - AD-143, assumed |
| How a PR merge names what it merges                | `gh pr merge` must name the head branch and use `--merge`; only the options in HBS-04 pass, in their separated form; a covered branch also needs `--match-head-commit <proven head>`                                                                                                                                                        | The gate cannot reach GitHub to map a number or URL to a branch; `main`'s ruleset allows merge commits only, which keep the progress trailers; `--match-head-commit` makes GitHub refuse a head nobody proved                                           | n - AD-144, assumed |
| Delivery-adjacent commands ADR 028 does not name   | A local merge into `main`, a push to `main`, to a remote other than `origin`, with no refspec or with any refspec that is not a ref name, `wrangler deploy`, `npm`/`pnpm publish`, `gh release delete`, any `gh api` call with a method other than `GET`, and the patch and plumbing commands of HBS-47 still ask                           | ADR 028 lists the delivery commands; `main` changes through the phase PR, Cloudflare deploys run in CI, no package is published, `gh api` writes can change settings, and a patch names no branch the gate can check. Stricter and reversible           | n - AD-145, assumed |
| Where the verdicts live                            | `verdicts.json` in the `d2rmm/` folder of the git common directory, next to the retry ledger; any Edit, Write or shell command that names that folder or its files is denied, except the read-only status commands                                                                                                                          | Outside the tracked tree, so no commit carries a forged verdict; worktrees share the common directory                                                                                                                                                   | n - AD-146, assumed |
| The commit a `pnpm test:harness` run proves        | `attempt.mjs` records, for every attempt, its command in its own field, `git rev-parse HEAD` and whether the working tree was clean; only a clean attempt proves a commit                                                                                                                                                                   | The guard needs "at the feature's head"; today the command lives only in the note of a passing attempt; uncommitted changes are not the head                                                                                                            | y - ADR 028 § 3     |
| Existing gate tests that assert `ask` for delivery | They change to the decisions of this spec; no test is removed                                                                                                                                                                                                                                                                               | ADR 028 supersedes ADR 021's escalation list for these commands; the test follows the accepted rule                                                                                                                                                     | y - ADR 028 § 1     |

**Open questions:** none - all resolved or logged above.

---

## Definitions

- **Main checkout**: the parent directory of `git rev-parse --git-common-dir`, whatever directory the hook runs from.
- **Covered feature**: a feature named in backticks on the ticked `harness-self` line of `## Delegation` that is also a
  row of the `## Features` table, in the brief named by `.specs/phases/ACTIVE` of the main checkout, when that brief
  carries an `**Approved**:` line. A worktree's copy of the brief is never read.
- **Covered branch**: `feat/<F>-<f>` for a covered feature `<f>`, where `<F>` is the active phase of the main checkout.
- **Ref name**: a token matching `[A-Za-z0-9._][A-Za-z0-9._/-]*` that does not start with `refs/`, `heads/` or
  `origin/`, contains no `..`, `@{`, `*`, `:` or `~`/`^`, and is not `main` or `HEAD`.
- **Resolves**: `git rev-parse --verify --quiet <operand>^{commit}` in the main checkout prints a commit.
- **Touches a covered branch**: an operand resolves, and the commits `git rev-list phase/<F>..<operand>` lists share at
  least one commit with `git rev-list phase/<F>..feat/<F>-<f>`. For `git pull`, each ref is tried as given and as
  `origin/<ref>`; for `gh pr merge`, the head branch is tried as given and as `origin/<branch>`.
- **Proven head**: the current head of `feat/<F>-<f>` in the main checkout, when the ledger holds an attempt for `<f>`
  whose command is exactly `pnpm test:harness`, which passed, on a clean tree, at that commit, and the latest verdict
  `verdicts.json` holds for `<f>` at that commit is a PASS.
- **Allowed shape**: the whole command line is one delivery command of HBS-01 to HBS-07, optionally preceded by
  `cd <dir> &&` where `<dir>` is a literal path that stays inside the main checkout. Every token of the delivery command
  is one the criterion lists, in the separated form it lists. A leading variable assignment, a git global option
  (`-c`, `-C`, `--git-dir`, `--work-tree` …), an attached option form (`--subject=x`, `-bx`), `$`, a backtick, `(`,
  `)`, `{`, `}`, `<`, `>`, `;`, `&`, `|`, a newline, a here-doc or a wrapper (`bash -c`, `sh -c`, `eval`, `xargs`,
  `env`, `sudo`, `timeout`) makes the line not an allowed shape.

---

## User Stories

### P1: Delivery runs without asking ⭐ MVP

**User Story**: As the runner, I want push, PR, merge, release, tag and workflow commands to pass the gate so that CI sees each feature when it is ready and the maintainer leaves the delivery loop.

**Why P1**: 49 asks in F0; every later row of revision 6 merges through PRs.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. HBS-01: WHEN the agent runs `git push` to the remote `origin`, with no option or only `-u`/`--set-upstream`, and one or more refspecs that are each a ref name, as an allowed shape THEN the gate SHALL answer `allow`
2. HBS-02: WHEN the agent runs `gh pr create`, `gh pr edit`, `gh pr ready` or `gh pr comment` with no `-R`/`--repo` option, as an allowed shape THEN the gate SHALL answer `allow`
3. HBS-03: WHEN the agent runs `gh pr merge <head-branch> --merge`, with only the options HBS-04 accepts, as an allowed shape, and the head branch is not a covered branch THEN the gate SHALL answer `allow`
4. HBS-04: IF `gh pr merge` carries any option other than `--merge`/`-m`, `--subject`/`-t <text>`, `--body`/`-b <text>`, `--match-head-commit <sha>` or `--auto`, each in that separated form THEN the gate SHALL deny it, and the reason SHALL name the rejected option and give `gh pr merge <head-branch> --merge`
5. HBS-05: IF `gh pr merge` names no head branch, or names a PR number or URL instead THEN the gate SHALL deny it, and the reason SHALL give `gh pr merge <head-branch> --merge`
6. HBS-06: WHEN the agent runs `gh release create`, `gh release edit`, `gh release upload`, `git tag <ref name>` with no option and no second operand, `gh workflow run` or `gh run rerun`, as an allowed shape THEN the gate SHALL answer `allow`
7. HBS-07: WHEN the agent runs `curl` with only the options `-f`, `-s`, `-S` (alone or combined), `--fail`, `--silent`, `--show-error` and `-X POST`, and the single URL `"$RENDER_DEPLOY_HOOK_URL"` or `"${RENDER_DEPLOY_HOOK_URL}"` THEN the gate SHALL answer `allow`; that URL is the one `$` an allowed shape may hold
8. HBS-08: IF a command line holding a delivery command of HBS-01 to HBS-07 is not an allowed shape THEN the gate SHALL NOT answer `allow`, and SHALL give the decision the rest of the line gets
9. HBS-09: `.claude/settings.json` `permissions.ask` SHALL NOT list `git push`, `gh pr merge` or `gh release`, and SHALL still list `gh secret`

**Independent Test**: feed the gate a `git push -u origin feat/F0-x` call and read `allow`.

---

### P1: What stays the maintainer's still asks or is denied ⭐ MVP

**User Story**: As the maintainer, I want secrets, repository settings and destructive remote operations to keep their decisions so that autonomous delivery cannot widen what the runner may change.

**Why P1**: ADR 028 § 1 keeps these; the required checks are the only lock before `main`.

**Acceptance Criteria**:

1. HBS-10: IF `git push` carries `-f`, any combined short option holding `f` (such as `-fu`), `--force`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `--delete`, `-d`, `--prune`, a refspec starting with `+` or a refspec starting with `:` THEN the gate SHALL deny it
2. HBS-11: IF `git push` targets a remote other than `origin`, names no refspec, or names a refspec that is not a ref name (`main`, `HEAD`, `refs/heads/main`, `feat/*`, a `src:dst` pair) THEN the gate SHALL ask
3. HBS-12: IF the agent runs `gh secret`, `gh variable set`, `gh variable delete` or `wrangler secret` THEN the gate SHALL ask
4. HBS-13: IF the agent runs `gh api` with a method other than `GET`, given by `-X`/`--method` or implied by `-f`, `-F`, `--field`, `--raw-field` or `--input`, or runs `gh api graphql` THEN the gate SHALL ask
5. HBS-14: IF a command runs `git merge` with `main` or `origin/main` among its arguments, or runs `git merge` while the current branch of the directory it runs in is `main`, or switches to `main` with `git checkout`/`git switch` and runs `git merge` in the same command line THEN the gate SHALL ask
6. HBS-15: IF the agent runs `wrangler deploy`, `wrangler pages deploy`, `npm`/`pnpm publish` or `gh release delete` THEN the gate SHALL ask
7. HBS-16: IF the agent runs `gh repo delete`, `gh repo archive` or `gh repo edit` THEN the gate SHALL deny it
8. HBS-17: The gate SHALL keep denying `--no-verify`, disabling Lefthook and the production database connection string, whatever command carries them

**Independent Test**: feed the gate `gh secret set X` and read `ask`; `git push origin HEAD:main` and read `ask`.

---

### P1: The harness-self scope ⭐ MVP

**User Story**: As the runner, I want a `harness-self` delegation that covers named features so that a harness feature edits the gate in its worktree without a prompt per edit.

**Why P1**: 25 asks in F0, and `gate-precision`, `budget-v2`, `continuous-delivery` and `fast-proofs` all edit self-protected files.

**Acceptance Criteria**:

1. HBS-18: The delegation scopes the gate reads SHALL include `harness-self`
2. HBS-19: WHEN the brief of the active phase ticks `harness-self` THEN the gate SHALL take as covered exactly the features the definition of a covered feature gives, reading the brief from the main checkout
3. HBS-20: WHERE feature X is covered, WHEN an Edit or Write targets a self-protected file whose path relative to the main checkout, after resolving `..` and the symbolic links of its nearest existing directory, starts with `.claude/worktrees/X/`, with `X` matched as a whole directory name, THEN the gate SHALL NOT ask for the self-protection, and every other edit rule SHALL still apply
4. HBS-21: IF the resolved path of such an Edit or Write does not lie under `.claude/worktrees/X/` of a covered X THEN the gate SHALL ask as before
5. HBS-22: IF an Edit or Write targets a self-protected file in the main checkout, or in the worktree of a feature that is not covered, or the brief does not tick `harness-self` THEN the gate SHALL ask as before
6. HBS-23: IF a shell command writes a self-protected file, in any checkout THEN the gate SHALL keep its current decision
7. HBS-24: The brief template's `## Delegation` SHALL list `harness-self`, unticked, naming the feature rows it covers in backticks and pointing to ADR 028

**Independent Test**: with a brief that ticks `harness-self` for `gate-precision`, edit `.claude/worktrees/gate-precision/.claude/hooks/gate.mjs` and see no ask; edit `.claude/hooks/gate.mjs` and see the ask.

---

### P1: A harness-self feature merges only under the guard ⭐ MVP

**User Story**: As the maintainer, I want every self-edit of the gate tested and independently reviewed before it merges so that a weaker gate needs a reviewed, tested change.

**Why P1**: ADR 028 § 3 makes the guard the condition of the scope.

**Acceptance Criteria**:

1. HBS-25: WHEN `scripts/attempt.mjs run` records an attempt THEN it SHALL record its command in a field of its own, the commit `git rev-parse HEAD` gives and whether `git status --porcelain` was empty, the last two in the directory where the command ran
2. HBS-26: WHEN a foreground `security-reviewer` dispatch whose prompt starts with `[d2rmm feature=<f> step=review-diff]` starts THEN the gate SHALL note the head of `feat/<F>-<f>` in `verdicts.json`, under the dispatch's `tool_use_id`
3. HBS-27: WHEN that dispatch returns a report whose last line starting with `VERDICT:`, trimmed, equals `VERDICT: PASS`, and the head of `feat/<F>-<f>` is still the noted one THEN the hooks SHALL record a PASS for `<f>` at the noted head
4. HBS-28: IF that report's last line starting with `VERDICT:`, trimmed, is anything other than `VERDICT: PASS`, or the report holds no such line or no readable text, or the branch head moved since the dispatch started THEN the hooks SHALL record a FAIL for `<f>` at the noted head
5. HBS-45: IF no `PostToolUse` call arrives for a noted dispatch THEN the hooks SHALL record no verdict for it, and the noted head alone SHALL NOT count as a proof
6. HBS-29: IF the dispatch is of another agent type or step, or its prompt has no `[d2rmm feature=… step=…]` header THEN the hooks SHALL record nothing
7. HBS-30: IF a `security-reviewer` dispatch with step `review-diff` asks to run in the background THEN the gate SHALL deny it, and the reason SHALL name `run_in_background: false`
8. HBS-31: IF an Edit or Write targets a path in the `d2rmm/` folder of the git common directory, or a shell command, inline interpreter code or an untracked script the gate reads names `d2rmm/`, `verdicts.json` or `ledger.json`, or changes directory into a `.git` directory THEN the gate SHALL deny it, except `node scripts/attempt.mjs status`, `node scripts/attempt.mjs report` and `node scripts/phase-status.mjs`
9. HBS-32: WHEN `git merge` or `gh pr merge` has an operand that touches a covered branch THEN the gate SHALL deny it unless the covered branch has a proven head and every commit `git rev-list phase/<F>..<operand>` lists is also listed by `git rev-list phase/<F>..<proven head>`
10. HBS-46: IF `gh pr merge` of a covered branch lacks `--match-head-commit <sha>` with `<sha>` the proven head, or `origin/<branch>` resolves to another commit THEN the gate SHALL deny it
11. HBS-33: WHEN the gate denies a merge under HBS-32 or HBS-46 THEN the reason SHALL name each missing proof, by `pnpm test:harness` through `scripts/attempt.mjs` and by a foreground `security-reviewer` dispatch with step `review-diff`, or name the commit it expected
12. HBS-34: IF `gh pr merge` of a covered branch carries `--auto` THEN the gate SHALL deny it
13. HBS-35: IF any git command has an operand that touches a covered branch, and the command is not read-only (`log`, `diff`, `show`, `rev-parse`, `rev-list`, `merge-base`, `status`, `ls-files`, `blame`, `branch --list`), not `checkout`/`switch` to that branch with no pathspec, not a `git push` of that branch name under HBS-01, and not a merge under HBS-32 THEN the gate SHALL deny it, and the reason SHALL give `git merge --no-ff feat/<F>-<f>`
14. HBS-47: IF an operand that names the commit to bring in does not resolve (a variable, a substitution, a glob, `FETCH_HEAD`, a branch that exists only remotely or no longer exists) THEN the gate SHALL deny it; those operands are the non-option operands of `git merge`, `git pull` (as `origin/<ref>`), `git rebase`, `git cherry-pick` and `gh pr merge`, the commit of `git reset`, the value of `git restore --source`, the start point of `git branch -f`/`--force`, and the tree-ish of `git checkout <tree-ish> -- <path>`
15. HBS-48: IF the agent runs `git apply`, `git am`, `patch`, `git read-tree`, `git update-ref`, `git update-index`, or `git fetch` with a `src:dst` refspec THEN the gate SHALL ask
16. HBS-36: WHEN a merge passes HBS-32 and HBS-46 THEN the gate SHALL give `gh pr merge` the decision of HBS-03, and a local `git merge` the decision it gets without the guard

**Independent Test**: in a temporary repository with a ticked `harness-self` brief, merge the feature branch with no verdict and read the denial; record a PASS and a passed `pnpm test:harness` at its head and see the merge pass.

---

### P1: The texts say what ADR 028 says ⭐ MVP

**User Story**: As any agent reading the guides, I want them to match the gate so that I do not stop to ask for what is now mine, nor take what is still the maintainer's.

**Why P1**: `AGENTS.md` wins over every other doc; a stale rule 7 would tell agents to ask for every push.

**Acceptance Criteria**:

1. HBS-37: `AGENTS.md` rule 7 SHALL contain `ADR 028`, `git push`, `pull requests`, `merges`, `releases`, `tags` and `workflow runs` as the runner's, and `secrets`, `production database`, `repository settings`, `rulesets` and `money` as the maintainer's
2. HBS-38: `AGENTS.md` rule 8 SHALL contain `brief`, `brief revision` and `ADR` as approvals that are the maintainer's
3. HBS-39: `AGENTS.md` "Phase workflow" escalation item SHALL NOT contain `push`, `merge to main` or `deploy`
4. HBS-40: The phase-runner `SKILL.md` SHALL NOT contain `never push` in any letter case, and its escalation summary SHALL NOT contain `push or merge to` or `deploy;`
5. HBS-41: `references/escalation.md` SHALL hold no table row whose first cell contains `push`, `PR merge`, `merge into`, `Deploy`, `release` or `tag`, and SHALL hold rows whose first cells contain `repository settings`, `rulesets` and `harness-self`
6. HBS-42: `CLAUDE.md` SHALL contain `harness-self` and name the hook file that records the `security-reviewer` verdict

**Independent Test**: read the four files and compare with ADR 028.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want this row to leave the product and contracts alone so that F0's numbers still hold.

**Why P1**: brief revision 6 is harness-only.

**Acceptance Criteria**:

1. HBS-43: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)
2. HBS-44: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped

**Independent Test**: run both commands.

---

## Edge Cases

- HBS-08 covers `git push … && rm -rf apps`, `…; gh secret set X`, `$(…)`, `bash -c "git push …"`,
  `GH_REPO=other gh pr merge …`, `git -c remote.origin.url=… push …` and `cd /elsewhere && git push …`.
- HBS-04 and HBS-05 cover `--squash`, `-s`, `--rebase`, `--admin`, `--delete-branch`, `-R`, `--subject=x`, a PR number
  and a PR URL.
- HBS-11 covers `git push origin HEAD:main`, `feat/F0-x:phase/F0`, `refs/heads/main`, `HEAD` and `feat/*`.
- HBS-28 covers a report that ends before its verdict, a PASS followed by a FAIL, and a commit made while the review ran.
- HBS-32 covers a branch that holds the proven head plus a further commit, and a stale or newer `origin/` ref.
- HBS-35 covers `reset --hard`, `branch -f`, `checkout <branch> -- <path>`, `restore --source`, `cherry-pick`,
  `rebase` and `pull`; HBS-47 covers a branch pushed, deleted locally and merged by name; HBS-48 covers patches.
- Commands this spec does not name (`gh repo rename`, `gh repo transfer`, `gh repo deploy-key`, `gh ruleset`,
  `gh pr close`, `gh pr review`, `git tag -d`) keep the decision they get today.

---

## Requirement Traceability

| Requirement ID | Story                               | Phase | Status  |
| -------------- | ----------------------------------- | ----- | ------- |
| HBS-01         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-02         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-03         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-04         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-05         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-06         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-07         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-08         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-09         | P1: Delivery runs without asking    | Tasks | Pending |
| HBS-10         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-11         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-12         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-13         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-14         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-15         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-16         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-17         | P1: What stays the maintainer's     | Tasks | Pending |
| HBS-18         | P1: The harness-self scope          | Tasks | Pending |
| HBS-19         | P1: The harness-self scope          | Tasks | Pending |
| HBS-20         | P1: The harness-self scope          | Tasks | Pending |
| HBS-21         | P1: The harness-self scope          | Tasks | Pending |
| HBS-22         | P1: The harness-self scope          | Tasks | Pending |
| HBS-23         | P1: The harness-self scope          | Tasks | Pending |
| HBS-24         | P1: The harness-self scope          | Tasks | Pending |
| HBS-25         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-26         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-27         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-28         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-29         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-30         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-31         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-32         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-33         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-34         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-35         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-36         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-37         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-38         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-39         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-40         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-41         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-42         | P1: The texts say what ADR 028 says | Tasks | Pending |
| HBS-43         | P1: Nothing else changes            | Tasks | Pending |
| HBS-44         | P1: Nothing else changes            | Tasks | Pending |
| HBS-45         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-46         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-47         | P1: Merges only under the guard     | Tasks | Pending |
| HBS-48         | P1: Merges only under the guard     | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 48 total, 48 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 2, § 3 (harness-bootstrap) and § 4 - the scope, approved by the maintainer ("Aprovo a revisão do ADR 028.")
- ADR 028 § 1 - delivery is the runner's; what stays the maintainer's (HBS-01 to HBS-17, HBS-37 to HBS-41)
- ADR 028 § 3 - the `harness-self` scope and its guard (HBS-18 to HBS-36, HBS-42, HBS-45 to HBS-48)
- ADR 021 - the delegation scopes and the escalation list this row amends (HBS-18, HBS-19, HBS-24, HBS-39 to HBS-41)
- ADR 022 - the retry ledger the guard reads (HBS-25, HBS-31, HBS-32)
- ADR 019 - the gate hook (HBS-08, HBS-17, HBS-23, HBS-31, HBS-47, HBS-48)
- ADR 020 - contract drift (HBS-43)
- `docs/product/prd.md#NFR-11` - harness verified in CI (HBS-44)
- `.github/rulesets/main.json` - `main` requires a PR, merge commits only, no bypass actors (HBS-03 to HBS-05, HBS-11, HBS-46)
- AD-138, AD-139 in `.specs/STATE.md` - the maintainer's decisions behind ADR 028

---

## Success Criteria

- [ ] The rows after this one run with no prompt for delivery and no prompt for edits inside their own worktrees.
- [ ] The first real `security-reviewer` `review-diff` dispatch of a covered feature records its verdict; if it records
      a FAIL for a report that ends `VERDICT: PASS`, the hook payload differs from AD-143 and the guard has failed
      closed, which `gate-precision`'s run reports.
- [ ] Every `harness-self` merge in the phase review shows its passed `pnpm test:harness` and its PASS at the merged head.
