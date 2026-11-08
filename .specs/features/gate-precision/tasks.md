# Gate Precision Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only `.claude/hooks/gate.mjs`, `.claude/hooks/lib/`, `.claude/hooks/test/`, `scripts/gate-replay/`, `scripts/gate-bench.mjs`, `scripts/test/`, two guides (`.claude/agents/feature-worker.md`, `.claude/skills/d2rmm-phase-runner/SKILL.md`) and the acceptance steps change. No product code, contract, scenario, `.claude/settings.json`, hook `timeout`, quality-baseline value or threshold changes.
- Every rule that already exists keeps its decision (GPR-27 to GPR-29). New rules are new functions with their own tests; an existing test is never edited to make a new rule pass.
- Every module under `.claude/hooks/lib/` stays pure: I/O goes through `ctx` (`git`, `realpath`, `stat`, `readFile`, `now`), built only in `gate.mjs` and `io.mjs`.
- Mutation proofs are per-module `node --test` files that spawn nothing (ADR 026). The tests that spawn the gate (T11), the bench (T15) and the acceptance steps (T16) are never mutation proofs.
- Under `harness-self` (ADR 028): this branch merges only at a head with a passed `pnpm test:harness` and a `security-reviewer` `VERDICT: PASS` on its diff (`review-diff`), which also reviews the replay fixture line by line.
- Every gate runs through `node scripts/attempt.mjs run --feature gate-precision --step T<n> -- "<gate>"`, launched with this worktree as the working directory, with nothing outside the quotes.
- Long work runs in the background or in the foreground with a long timeout; never poll with `sleep` or status loops.

---

**Design**: `.specs/features/gate-precision/design.md`
**Status**: Approved
**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm lint; pnpm typecheck; pnpm test:harness`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (How to test, rules 3, 4 and 12), `docs/engineering/testing.md`, ADR 026.

| Code Layer                                            | Required Test Type                               | Coverage Expectation                                                               | Location Pattern                                 | Run Command                                            |
| ----------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Pure gate modules (parse, read-only, writes, polling) | unit (`node --test`, fake `ctx` and clock)       | 1:1 to GPR ACs; every edge case of the spec; every table row with a refused option | `.claude/hooks/test/<module>.test.mjs`           | `node --test .claude/hooks/test/<module>.test.mjs`     |
| `io.mjs` and the history store                        | unit (`node --test`, temporary dirs, fake spawn) | deadline, caps, safe read, lock, prune, corrupt file                               | `.claude/hooks/test/<module>.test.mjs`           | `node --test .claude/hooks/test/<module>.test.mjs`     |
| `gate.mjs` start-up                                   | harness (spawns the gate; not a mutation proof)  | GPR-20, GPR-21, watchdog, malformed input                                          | `.claude/hooks/test/gate-startup.test.mjs`       | `node --test .claude/hooks/test/gate-startup.test.mjs` |
| Replay extractor and corpus                           | unit (`node --test`, fake `ctx`)                 | GPR-23 to GPR-26, normalisation, character classes                                 | `scripts/test/gate-replay*.test.mjs`             | `node --test scripts/test/gate-replay.test.mjs`        |
| Guides                                                | unit (`node --test`, reads the file)             | GPR-19                                                                             | `scripts/test/phase-runner-skill.test.mjs`       | `node --test scripts/test/phase-runner-skill.test.mjs` |
| The gate as an agent meets it                         | acceptance (playwright-bdd)                      | Every scenario of `acceptance.feature`                                             | `tests/acceptance/steps/gate-precision.steps.ts` | `pnpm exec turbo run test:acceptance -- --grep @GPR-`  |

## Gate Check Commands

| Gate Level | When to Use         | Command                                               |
| ---------- | ------------------- | ----------------------------------------------------- |
| Quick      | Unit tasks          | the task's `node --test` command                      |
| Full       | The acceptance task | `pnpm exec turbo run test:acceptance -- --grep @GPR-` |
| Build      | After the last task | `pnpm lint; pnpm typecheck; pnpm test:harness`        |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Parse, bounded I/O, the read-only rule

```
T1 → T2 → T3 → T4
```

### Phase 2: Writes, scripts, sensor help and the package scope

```
T4 → T5 → T6 → T7
```

### Phase 3: Polling

```
T7 → T8 → T9
```

### Phase 4: Wiring and guides

```
T9 → T10 → T11 → T12
```

### Phase 5: Replay and benchmark

```
T12 → T13 → T14 → T15
```

### Phase 6: Scenarios

Starts after `budget-v2` is merged into `phase/F0`: the orchestrator merges `phase/F0` into this branch first, so `tests/acceptance/support/gate-world.ts` exists.

```
T15 → T16
```

---

## Task Breakdown

### T1: Tokenize a command line

**What**: `.claude/hooks/lib/shell-parse.mjs` with `parseLine(text)` → `{ segments, operators, unsafe }` and `expandOptions(words, spec)`, as the design's `shell-parse.mjs` section and Data Models say: quote-aware words (`quoted`, `expands`), operators `|` and `&&` outside quotes, the four whole tokens `2>&1`, `>/dev/null`, `2>/dev/null`, `&>/dev/null` taken out, every other redirection recorded with its target, and every GPR-03 shape listed in `unsafe`. Unbalanced quotes or input over 2 MB give `unsafe: ['unparsed']`. Clusters (`-la`), glued numbers (`-A3`, `-n20`, `head -20` as `-n 20`) and `--long=value` per the spec's Options paragraph.
**Where**: `.claude/hooks/lib/shell-parse.mjs`
**Depends on**: None
**Reuses**: none (the old `splitCommands` stays for the old rules)
**Requirement**: GPR-03

**Done when**:

- [ ] Each GPR-03 shape lands in `unsafe`, one case each, including the spec's edge cases (`cat a` and `rm b` on two lines, `cat $(ls)`, `ls > out.txt`, `grep x <(cat y)`, `cat .e*`, `cat .en{v,v}`, `git log -p -- '.e*'`, `git ls-files ':(glob).e*'`) (test `lists every unsafe shape`)
- [ ] A single-quoted string is one word with its spaces and `|`; `-H'Accept: x'` is one word; `'x$'` does not expand (test `keeps single-quoted text as one word`)
- [ ] `2>&1` and `2>/dev/null` are taken out; `> out.txt` is a redirection with its target (test `takes out only the four whole tokens`)
- [ ] Clusters, glued numbers and `=value` expand as the spec says (test `expands options`)
- [ ] An unbalanced quote and a 2 MB line give `unparsed` (test `fails closed on what it cannot read`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/shell-parse.test.mjs`

**Commit**: `feat(harness): tokenize a command line for the gate`

---

### T2: Bounded I/O for the gate

**What**: In `.claude/hooks/lib/io.mjs`, a `makeIo({ now, spawn, fs, deadlineMs })` that returns the `ctx` I/O of the design: one deadline for the whole call (5 s by default); `git(args)` through `execFileSync` with an argument array, `-c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, `killSignal: 'SIGKILL'` and a timeout of `min(2 s, time left)`, counting spawns; `readFile(path)` that opens with `O_RDONLY | O_NONBLOCK`, `fstat`s the descriptor and reads only a regular file with `nlink` 1 and at most 1 MB from that descriptor; `realpath` and `stat` that check the deadline before they start. Past the deadline or on a spawn timeout each call returns `{ timedOut: true }` instead of throwing. Existing exports keep their behaviour.
**Where**: `.claude/hooks/lib/io.mjs` (modify)
**Depends on**: T1
**Reuses**: the existing `git` helper and `resolveInside` of `io.mjs`
**Requirement**: GPR-20

**Done when**:

- [ ] A fake clock past 5 s makes `git`, `readFile`, `realpath` and `stat` return `timedOut` without starting (test `checks the deadline before each call`)
- [ ] A spawn's timeout is `min(2 s, time left)` and the options above are passed (test `bounds each git spawn`)
- [ ] `readFile` refuses a FIFO, a directory, a hard-linked file and a file over 1 MB, and never blocks on the FIFO (test `reads only a small regular file with one link`)
- [ ] Every existing test of `io.mjs` callers still passes
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/io.test.mjs .claude/hooks/test/gate-rules.test.mjs`

**Commit**: `feat(harness): bound the gate's I/O with one deadline`

---

### T3: The read-only table and its options

**What**: `.claude/hooks/lib/read-only.mjs`, part 1 (no I/O): `READ_ONLY_TABLE` with one entry per row of the spec's read-only table (allowed options, operand rules, extra checks: the `sed -n` script shapes, `jq` banned words as whole words, `gh api` endpoint and `-H` values, `git fetch` remote and refspecs, `git branch` listing only, `gh` positionals limited to digits or branch-like names with no `:` or `//`, `node scripts/…` operands); `isSafeWord(word)` (and no word starting with `=`); numeric option values digits only; `matchShape(parsed)` → the table rows of each segment, or `null` when any segment, option, word, environment assignment, command word with a `/`, or `git` global option is outside the table.
**Where**: `.claude/hooks/lib/read-only.mjs`
**Depends on**: T2
**Reuses**: `parseLine`, `expandOptions` (T1)
**Requirement**: GPR-02, GPR-32

**Done when**:

- [ ] Each table row has an allowed case and a refused-option case (test `matches each table row and refuses its other options`)
- [ ] Abbreviations (`--out`), glued unlisted options (`-XPOST`, `--method=POST`), `git -c`/`-C`/`--git-dir`/`--work-tree`/`--exec-path`, `rg -g`/`-e`, `grep -r`/`-e`/`-f`, `diff -r`, `awk` and `sed` regular expressions are refused (test `refuses the forms AD-163 drops`)
- [ ] `jq -n env` and `gh api x --jq env` are refused; `.environment` is allowed (test `matches banned jq words whole`)
- [ ] `./git log` and `/tmp/cat a.txt` match no row (test `needs the bare command word`)
- [ ] `NAME=value cat a` and `=cat a` match no row (test `refuses assignments and equals words`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/read-only.test.mjs`

**Commit**: `feat(harness): describe the read-only commands the gate allows`

---

### T4: Read paths, secrets and the working directory

**What**: `.claude/hooks/lib/read-only.mjs`, part 2: `pathOperands(segment, ctx)` per the spec's Definitions (revisions of `git diff/log/show` resolved with `git rev-parse --verify --quiet --end-of-options`, `<rev>:<path>` paths normalised against the working directory); `isSecretName(path)` (case-insensitive, the spec's list, the git common directory and everything under it, trailing `/` and `/.` removed); `isReadPath(path, ctx)` (inside the checkout, written path and resolved target both checked, regular file, `nlink` 1, not ignored by one batched `git check-ignore --stdin` per line); the working-directory rule (`input.cwd` realpath'd, inside the checkout, no nested repository other than a `.claude/worktrees/<feature>` worktree; a leading `cd <dir>` resolved with `realpath` the same way); `ls -R`/`find` refused when a start point contains the git common directory; caps of 200 words, 64 path operands and 8 `git` spawns; `readOnlyDecision(parsed, input, ctx)` → `allow`, `deny` (a secret name in any operand, option value or `<rev>:<path>` of a table command, GPR-30) or `null`, with `ask` only when a deny check timed out.
**Where**: `.claude/hooks/lib/read-only.mjs` (extend)
**Depends on**: T3
**Reuses**: `ENV_FILE` and the protected-path predicates of `gate-rules.mjs`, `resolveInside`, `mainCheckout` of `io.mjs`, `makeIo` (T2)
**Requirement**: GPR-01, GPR-30, GPR-31

**Done when**:

- [ ] The Independent Test lines of the spec: `cd apps && rg -n foo api/package.json 2>/dev/null | head -n 20` → `allow`, `rg -n foo apps` → `null`, `grep KEY apps/api/.env` → `deny` (test `decides the spec's independent test`)
- [ ] Every GPR-30 edge case denies (`grep K apps/api/.env`, `grep -e K apps/api/.env`, `git show HEAD:.env`, `git log -p -- .npmrc`, `jq . .npmrc`, `cat .ENV`, `cat apps/api/.Env.local`) (test `denies a secret name in any operand`)
- [ ] `cat ~/.ssh/id_rsa`, `cat /proc/self/environ`, `git diff --no-index`, a `..` escape and a symbolic link out of the checkout get no `allow` (test `allows nothing outside the checkout`)
- [ ] A `cwd` outside the checkout, a missing `cwd` and a `cwd` in a nested repository get no `allow`; a worktree `cwd` does (test `resolves operands against the call's working directory`)
- [ ] A hard link to a file, an ignored file and a directory as a read path get no `allow` (test `allows only plain tracked or untracked files`)
- [ ] Over each cap, and with a fake `git` that times out, there is no `allow`; a timed-out deny check gives `ask` (test `stops at its caps and its deadline`)
- [ ] `git log -p` with no path is allowed (AD-164) (test `allows the whole history`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/read-only.test.mjs`

**Commit**: `feat(harness): allow read-only commands inside the checkout`

---

### T5: Shell writes and their targets

**What**: `.claude/hooks/lib/writes.mjs` with `writeTargets(parsed)` (GPR-05's writes: output redirections to a file, `tee` with a file operand, `sed -i`/`--in-place`, `perl -i`, `truncate`, `install` with a file operand, `cp` any operand, `mv`/`ln` source and target) and `writeDecision(parsed, ctx)`: `deny` naming the Edit tool for a harness or sensor file, the quality baseline or a test file (GPR-08); `ask` for a self-protected file (GPR-10); `null` otherwise. `/dev/null`, `/dev/stdout`, `/dev/stderr`, `&1`, `&2` and a `>` inside quotes are never targets (GPR-06). `ln`, `install` and `cp` with a secret-name source join the secret-copy deny. `dd of=`, `curl -o`, `wget -O`, `patch` and `git apply` return `null` (today's rules decide them).
**Where**: `.claude/hooks/lib/writes.mjs`
**Depends on**: T4
**Reuses**: `isHarnessFile`, `isSelfProtected`, `TEST_FILE`, `BASELINE` of `gate-rules.mjs`; `isSecretName` (T4)
**Requirement**: GPR-05, GPR-06, GPR-07, GPR-08, GPR-10

**Done when**:

- [ ] Each write form of GPR-05 is found with its target (test `finds every shell write`)
- [ ] `cat .claude/hooks/gate.mjs 2>&1 | head -n 5`, `echo "a > b"`, `grep '>' file` give no write (test `a read is never a write`)
- [ ] `echo x > eslint.config.mjs` denies with a reason naming the Edit tool; a write to a self-protected file asks (test `denies harness writes and asks for self-protected ones`)
- [ ] `ln apps/api/.env x.txt` and `cp apps/api/.env x` deny (test `refuses a secret as a copy source`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/writes.test.mjs`

**Commit**: `feat(harness): tell shell reads from shell writes`

---

### T6: Scripts judged by what they hold

**What**: In `.claude/hooks/lib/gate-rules.mjs`, new functions `scriptKind(path, ctx)` and `scriptDecision(segment, input, ctx)`: a script outside the repository is judged like an untracked one inside it (GPR-11); `text-shell` only for the exact shebangs of the design or no shebang with `.sh`, run by a shell or as the command word; a shell script whose every line (shebang, comments, blank lines and `set -e` forms skipped) is a read-only shape under `readOnlyDecision` gets `allow`; a script unreadable, not such a text file, or running or sourcing another file outside the checkout asks (GPR-12); the script token rules of GPR-13; inline code and scripts that write a GPR-08 file deny with the Edit-tool reason, and a self-protected one asks (GPR-09, GPR-10); every deny and ask rule judges the command word by its last path segment (GPR-32). Existing `checkScript`/`checkInlineCode` call the new functions; their current decisions for existing cases do not change.
**Where**: `.claude/hooks/lib/gate-rules.mjs` (modify)
**Depends on**: T5
**Reuses**: `checkScript`, `checkInlineCode`, `readOnlyDecision` (T4), `writeDecision` (T5), `makeIo().readFile` (T2)
**Requirement**: GPR-09, GPR-11, GPR-12, GPR-13, GPR-32

**Done when**:

- [ ] A read-only shell script in a scratchpad gets `allow`; one with `rm` gets today's decision for `rm` (test `judges a script outside the repository by its content`)
- [ ] A binary, a FIFO, a 2 MB file and a script sourcing `/tmp/x.sh` ask (test `asks for a script it cannot judge`)
- [ ] `python3 x.sh` and `node x.sh` never get the shell verdict; a `#!/usr/bin/env bash -x` script is not `text-shell` (test `needs a shell to run a shell script`)
- [ ] `rg '//' src`, `ls /**` and `git log --grep '/fix/'` take no token as a script (test `takes only real script tokens`)
- [ ] `python3 -c "open('eslint.config.mjs','w')"` denies naming the Edit tool (test `denies inline code that writes a harness file`)
- [ ] `/bin/rm -rf apps` gets the decision of `rm -rf apps` (test `judges a command word by its last segment`)
- [ ] A comment line ending in `\` or `'` changes nothing (test `skips comments whole`)
- [ ] Every existing test of `gate-rules.test.mjs` passes unchanged
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/gate-rules.test.mjs .claude/hooks/test/scripts.test.mjs`

**Commit**: `feat(harness): judge scripts outside the repository by their content`

---

### T7: Sensor help and the package scope

**What**: In `.claude/hooks/lib/budget-rules.mjs`, two new exported functions, each a few lines, called from the existing rules: `isSensorHelp(command)` — the whole line is one sensor command (GPR-14's tools, direct or through `pnpm exec`, `npx` or `cargo`) whose only argument after the tool name is `--help`, `-h`, `--version` or `--list`; `runsSensor` skips the wrapper rule for it. `isPackageScopeOnly(command)` — the only `d2rmm/` is `@d2rmm/<package-name>` followed by a space, a quote or the end of the word; the `LEDGER_REF` rule skips such a line, and `@d2rmm/x$(…)`, `@d2rmm/x/../ledger`, `verdicts.json`, `ledger.json` and `cd .git` keep their deny (GPR-33).
**Where**: `.claude/hooks/lib/budget-rules.mjs` (modify)
**Depends on**: T6
**Reuses**: `runsSensor`, `LEDGER_REF`
**Requirement**: GPR-14, GPR-33

**Done when**:

- [ ] `pnpm exec vitest --help`, `npx stryker --version`, `cargo nextest --list` pass the wrapper rule on a feature branch; `pnpm test --help` and `vitest --help | head` do not (test `lets a sensor's help through`)
- [ ] `pnpm --filter @d2rmm/api test` is not a ledger reference; `@d2rmm/x$(cat y)`, `@d2rmm/x/../ledger`, `.git/d2rmm/ledger.json` still deny (test `a package scope is not the ledger`)
- [ ] Every existing test of `budget-rules.test.mjs` passes unchanged
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/budget-rules.test.mjs`

**Commit**: `feat(harness): let sensor help and package scopes through`

---

### T8: Polling rules

**What**: `.claude/hooks/lib/polling.mjs`: `sleepSeconds(parsed)` (sum over the line and nested `sh -c`/`bash -c` text; `s`/`m`/`h`/`d` suffixes; `Infinity` for `infinity`, a non-decimal like `1e2` or a non-literal; the command word read after `command`, `env`, `timeout N`, `xargs` and a leading `\`); `pollingLoop(parsed)` (a `for`/`until`/`while` whose body runs `sleep`, and `watch`); `repeatDecision(command, sid, history, now)` (the fifth identical trimmed command within 10 minutes → `deny`, returning the effect `{ op: 'history', sid, hash, at }` for every call); one exported `POLLING_REASON` constant: run long work in the background and wait for its task notification.
**Where**: `.claude/hooks/lib/polling.mjs`
**Depends on**: T7
**Reuses**: `parseLine` (T1), `innerShellCommands` of `shell-indirection.mjs`
**Requirement**: GPR-15, GPR-16, GPR-17, GPR-18

**Done when**:

- [ ] `sleep 30` passes; `sleep 31`, `sleep 1m`, `sleep 20 && sleep 20`, `sleep infinity`, `sleep $N`, `sleep 1e2`, `bash -c "sleep 40"`, `env sleep 40`, `timeout 5 sleep 40` deny (test `adds up sleeps`)
- [ ] `while true; do sleep 1; done`, `until x; do sleep 1; done` and `watch git status` deny (test `refuses polling loops`)
- [ ] With a fake clock the fourth identical call passes, the fifth denies, and a fifth after 10 minutes passes (test `refuses the fifth identical call within ten minutes`)
- [ ] Every polling deny carries `POLLING_REASON` (test `says to wait for the notification`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/polling.test.mjs`

**Commit**: `feat(harness): refuse polling with what to do instead`

---

### T9: The call history store

**What**: `.claude/hooks/lib/history-store.mjs`: `historyPath(root)` from the git common directory as `ledgerPath()` resolves it (a worktree's `.git` is a file); `loadHistory(file)`; `withHistory(file, fn, { now })` — a lock that waits at most 200 ms and breaks a lock older than 10 s, prunes entries older than 10 minutes, caps 50 entries per session and 64 sessions, writes `{ version: 1, sessions }` with mode 0600, and moves a corrupt file to a single `history.json.corrupt`. A locked or corrupt store reads as empty (fails open on purpose).
**Where**: `.claude/hooks/lib/history-store.mjs`
**Depends on**: T8
**Reuses**: the lock pattern of `scripts/lib/ledger-store.mjs`, `ledgerPath()`
**Requirement**: GPR-17

**Done when**:

- [ ] The path resolves to the common directory from a worktree (test `stores history next to the ledger`)
- [ ] Prune, both caps and mode 0600 hold (test `keeps ten minutes and caps entries`)
- [ ] A held lock past 200 ms reads empty; a 10 s old lock is broken (test `never waits long on the lock`)
- [ ] A corrupt file is moved to one `.corrupt` file and reads empty (test `sets a corrupt file aside once`)
- [ ] The file holds hashes only, never a command (test `stores no command text`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test .claude/hooks/test/history-store.test.mjs`

**Commit**: `feat(harness): keep a short history of calls for the polling rule`

---

### T10: Wire the rules in order

**What**: In `.claude/hooks/lib/gate-rules.mjs` `checkBash` (and `decide`): existing hard denies first; then the spawn-free scans (secret names, ledger and verdicts, `writeDecision`, polling); then the existing segment rules, indirections, scripts, delivery and the guard; `readOnlyDecision`'s `allow` only when every earlier step gave no opinion (GPR-04). `decide({})` and an input with no `tool_name` have an explicit `ask` path. `ratchet`, `acceptance`, `mutation-scope` (`gate-rules.mjs`) and `model-policy` (`budget-rules.mjs`) are no longer imported statically: the rules read them from `ctx.modules` and answer `ask` when a needed one is missing.
**Where**: `.claude/hooks/lib/gate-rules.mjs` (modify)
**Depends on**: T9
**Reuses**: T4, T5, T6, T8
**Requirement**: GPR-04, GPR-21

**Done when**:

- [ ] A line `readOnlyDecision` would allow that another rule denies or asks gets that rule's decision, for a deny, an ask and a guard deny (test `allow comes last`)
- [ ] `decide({})` asks (test `asks on an empty call`)
- [ ] Importing `gate-rules.mjs` loads none of the four modules (test `loads no rule module eagerly`)
- [ ] A rule whose module is missing from `ctx.modules` asks (test `asks when a rule module is missing`)
- [ ] Every existing test under `.claude/hooks/test/` passes unchanged (the tests pass the modules in `ctx`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test ".claude/hooks/test/*.test.mjs"`

**Commit**: `feat(harness): run the new gate rules in order, allow last`

---

### T11: Gate start-up

**What**: In `.claude/hooks/gate.mjs`: an 8 s watchdog armed first that writes `ask` and exits 0; stdin read into a `Buffer`, over 100 MB → `ask` before any parse or path rule; JSON parsed once, a failure → `ask` with a log line; `ctx` built with `makeIo` (5 s deadline) and the history; `ratchet`, `acceptance`, `mutation-scope` and `model-policy` loaded with `import()` only for the calls that need them (an Edit of the baseline, an Edit of a `.feature` file, a mutation run, a dispatch), a failed `import()` → `ask`; the `history` effect applied through `withHistory`; content over 10 MB for a content rule → `ask`; no log line holds the command or raw input.
**Where**: `.claude/hooks/gate.mjs` (modify)
**Depends on**: T10
**Reuses**: `makeIo` (T2), `withHistory` (T9), `decide` (T10)
**Requirement**: GPR-20, GPR-21

**Done when**:

- [ ] A 101 MB input, a malformed JSON and an empty stdin each get a decision with exit 0 and no hook error (test `answers every input`)
- [ ] A read-only Bash call loads none of the four modules; an Edit of `.quality-baseline.json` loads the ratchet (test `loads rule modules only when needed`)
- [ ] A stalled stdin gets `ask` from the watchdog within 9 s (test `answers before the hook timeout`)
- [ ] The log carries no command text (test `logs no command`)
- [ ] Gate passes

**Tests**: harness (spawns the gate; not a mutation proof)
**Gate**: `node --test .claude/hooks/test/gate-startup.test.mjs`

**Commit**: `feat(harness): start the gate fast and never fail on its input`

---

### T12: Guides say to wait, never poll

**What**: `.claude/agents/feature-worker.md` and `.claude/skills/d2rmm-phase-runner/SKILL.md` each gain one sentence: run long work in the background (or in the foreground with a long timeout) and wait for its task notification; never poll with `sleep` or status loops. `scripts/test/phase-runner-skill.test.mjs` gains a test that both files say it.
**Where**: `.claude/agents/feature-worker.md`, `.claude/skills/d2rmm-phase-runner/SKILL.md`, `scripts/test/phase-runner-skill.test.mjs`
**Depends on**: T11
**Reuses**: the existing reads of `phase-runner-skill.test.mjs`
**Requirement**: GPR-19

**Done when**:

- [ ] Both guides carry the sentence (test `the guides say to wait for the notification`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/phase-runner-skill.test.mjs`

**Commit**: `docs(harness): tell agents to wait for notifications instead of polling`

---

### T13: The replay extractor

**What**: `scripts/gate-replay/extract.mjs` (run by hand, never in CI) with pure, exported functions: `normalise(text, env)` (repository path → `<repo>`, `/Users/*` and `/home/*` → `~`, the scratchpad → `<scratchpad>`, session ids, UUIDs, IP addresses and runs of 20 or more hex or base64 characters → `<v>`); `reemitBash(command)` (word by word from `parseLine`: a safe word naming no value — a command word, a table option, a checkout path, a revision or branch name passing the safe-word grammar — kept, every other word, quoted string, option value, URL and here-document body → `<v>`); `entryOf(toolCall, result)` (Bash → the re-emitted command; Edit, Write, Read, Agent → only `file_path` or `subagent_type`, a size bucket `<1k`/`<100k`/`≥100k` and the matched gate pattern; never content, `old_string`/`new_string` or a prompt; `f0.reason` normalised, dropped when a word stays outside the grammar); `categoryOf(entry)`. The CLI reads the transcripts given on its command line, keeps calls answered by a gate deny or ask or a permission prompt, dedupes, prints the count dropped per category, and writes `scripts/test/fixtures/gate-replay.json`.
**Where**: `scripts/gate-replay/extract.mjs`
**Depends on**: T12
**Reuses**: `parseLine` (T1), `isSafeWord` (T3)
**Requirement**: GPR-23, GPR-24

**Done when**:

- [ ] Each normalisation, on a made-up line holding every kind (test `normalises paths, ids and long tokens`)
- [ ] `curl -H "Authorization: Bearer abc" https://x.example/y` re-emits with `<v>` for the header and URL; `git log --oneline -5` is unchanged (test `keeps only safe words`)
- [ ] An Edit entry holds no `old_string`, `new_string` or content; an Agent entry holds no prompt (test `keeps no content or prompt`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/gate-replay-extract.test.mjs`

**Commit**: `feat(harness): extract the F0 gate replay by allow-list`

---

### T14: The F0 replay corpus and its test

**What**: Run the extractor once on the F0 transcripts of this machine and commit `scripts/test/fixtures/gate-replay.json`. `scripts/test/gate-replay.test.mjs`: the category → expected decision table of GPR-26 fixed in the test; GPR-23's coverage (at least one entry for each of the four named friction rows, counted on the kept entries); GPR-24 (no home path, scratchpad path, e-mail address, host other than `github.com`/`localhost`, or run of 20 or more hex/base64 characters; every string in the allowed character classes); one `decide` per entry with a fake `ctx` (`git`, `stat`, `readFile`, `realpath` answered from a fixture table in the test) equal to its category's decision (GPR-25); and the old-rules-versus-new test: the new read-only rule never yields `allow` for an entry an old rule denies or asks.
**Where**: `scripts/test/gate-replay.test.mjs`, `scripts/test/fixtures/gate-replay.json`
**Depends on**: T13
**Reuses**: `decide` (T10), the extractor (T13)
**Requirement**: GPR-23, GPR-24, GPR-25, GPR-26

**Done when**:

- [ ] `pnpm secrets:scan` passes with the fixture staged
- [ ] Every entry decides as its category says (test `replays F0 with the expected decisions`)
- [ ] The four friction rows are covered (test `covers the F0 friction rows`)
- [ ] No private value is in the corpus (test `holds nothing private`)
- [ ] The new rule never allows what an old rule stops (test `never allows what an old rule stops`)
- [ ] Gate passes

**Tests**: unit
**Gate**: `node --test scripts/test/gate-replay.test.mjs`

**Commit**: `test(harness): replay the F0 gate decisions`

---

### T15: The gate benchmark

**What**: `scripts/gate-bench.mjs`: replays every corpus entry three times, each as a cold `node .claude/hooks/gate.mjs` process with a temporary project directory, prints p50 and p95, and exits 1 when p95 is above 300 ms. Its pure parts (`percentile(values, p)`, the input built from an entry) are exported and unit-tested; `scripts/test/gate-bench.test.mjs` also counts `git` spawns per corpus line through a counting fake `ctx` and checks none exceeds the cap of 8.
**Where**: `scripts/gate-bench.mjs`
**Depends on**: T14
**Reuses**: the corpus (T14), `makeIo` spawn counting (T2)
**Requirement**: GPR-22

**Done when**:

- [ ] `percentile` and the per-entry input are right (test `computes the percentile`)
- [ ] No corpus line spawns more than 8 `git` processes (test `stays under the spawn cap`)
- [ ] `node scripts/gate-bench.mjs` prints p95 at most 300 ms on this machine and exits 0
- [ ] Gate passes

**Tests**: unit (the bench itself is a harness run, not a mutation proof)
**Gate**: `node --test scripts/test/gate-bench.test.mjs && node scripts/gate-bench.mjs`

**Commit**: `feat(harness): benchmark the gate on the F0 replay`

---

### T16: Scenarios

**What**: `tests/acceptance/steps/gate-precision.steps.ts`: the steps of every scenario of `acceptance.feature`, black box, running `.claude/hooks/gate.mjs` of this checkout as a child process against a temporary repository. The Background step `a temporary repository with an approved phase brief for "F0" on the branch "feat/F0-demo"` builds the repository the same way the `harness-bootstrap` Given does and stores it in `tests/acceptance/support/gate-world.ts`; the steps whose text already exists ("the agent asks the gate to run …", "the gate answers …", "the gate does not answer …", "the reason names …") are reused, never defined again. Starts after `phase/F0` (with `budget-v2`) is merged into this branch.
**Where**: `tests/acceptance/steps/gate-precision.steps.ts`
**Depends on**: T15
**Reuses**: `support/gate-world.ts`, `harness-bootstrap.steps.ts`
**Requirement**: GPR-01, GPR-03, GPR-04, GPR-05, GPR-06, GPR-07, GPR-08, GPR-09, GPR-10, GPR-11, GPR-12, GPR-13, GPR-14, GPR-15, GPR-16, GPR-17, GPR-18, GPR-20, GPR-30, GPR-31, GPR-32, GPR-33

**Done when**:

- [ ] Every scenario of `acceptance.feature` passes
- [ ] `pnpm test:harness`, `pnpm contracts:check` and the `@HBS-` scenarios pass with no test removed or skipped (GPR-27 to GPR-29)
- [ ] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep "@GPR-|@HBS-" && pnpm test:harness && pnpm contracts:check`

**Commit**: `test(harness): acceptance steps for gate precision`

---

## Checks

**C1** - A read-only line inside the checkout gets `allow`; a directory read path and a secret do not (GPR-01, AC 1)
Proof: `node --test --test-name-pattern "decides the spec's independent test" .claude/hooks/test/read-only.test.mjs`

**C2** - Each table row allows only its listed options (GPR-02, AC 2)
Proof: `node --test --test-name-pattern "matches each table row and refuses its other options" .claude/hooks/test/read-only.test.mjs`

**C3** - Every GPR-03 shape is unsafe and never allowed (GPR-03, AC 3)
Proof: `node --test --test-name-pattern "lists every unsafe shape" .claude/hooks/test/shell-parse.test.mjs`

**C4** - Another rule's deny or ask beats the read-only allow (GPR-04, AC 4)
Proof: `node --test --test-name-pattern "allow comes last" .claude/hooks/test/gate-rules.test.mjs`

**C5** - Every GPR-05 write form is found (GPR-05)
Proof: `node --test --test-name-pattern "finds every shell write" .claude/hooks/test/writes.test.mjs`

**C6** - A read with `2>&1` or a quoted `>` is never a write (GPR-06, GPR-07)
Proof: `node --test --test-name-pattern "a read is never a write" .claude/hooks/test/writes.test.mjs`

**C7** - A shell write to a harness file denies naming the Edit tool; a self-protected one asks (GPR-08, GPR-10)
Proof: `node --test --test-name-pattern "denies harness writes and asks for self-protected ones" .claude/hooks/test/writes.test.mjs`

**C8** - Inline code that writes a harness file denies naming the Edit tool (GPR-09)
Proof: `node --test --test-name-pattern "denies inline code that writes a harness file" .claude/hooks/test/scripts.test.mjs`

**C9** - A read-only script outside the repository is allowed by its content (GPR-11)
Proof: `node --test --test-name-pattern "judges a script outside the repository by its content" .claude/hooks/test/scripts.test.mjs`

**C10** - A script the gate cannot judge asks (GPR-12)
Proof: `node --test --test-name-pattern "asks for a script it cannot judge" .claude/hooks/test/scripts.test.mjs`

**C11** - Only real script tokens are taken as scripts (GPR-13)
Proof: `node --test --test-name-pattern "takes only real script tokens" .claude/hooks/test/scripts.test.mjs`

**C12** - A sensor's `--help` passes the wrapper rule; a pipe or `pnpm <script> --help` does not (GPR-14)
Proof: `node --test --test-name-pattern "lets a sensor's help through" .claude/hooks/test/budget-rules.test.mjs`

**C13** - Sleeps over 30 s, or not literal, deny (GPR-15)
Proof: `node --test --test-name-pattern "adds up sleeps" .claude/hooks/test/polling.test.mjs`

**C14** - A loop that sleeps denies (GPR-16)
Proof: `node --test --test-name-pattern "refuses polling loops" .claude/hooks/test/polling.test.mjs`

**C15** - The fifth identical call within 10 minutes denies; the fourth and a later fifth pass (GPR-17)
Proof: `node --test --test-name-pattern "refuses the fifth identical call within ten minutes" .claude/hooks/test/polling.test.mjs`

**C16** - Every polling deny says to wait for the task notification (GPR-18)
Proof: `node --test --test-name-pattern "says to wait for the notification" .claude/hooks/test/polling.test.mjs`

**C17** - Both guides say to wait for notifications and never poll (GPR-19)
Proof: `node --test --test-name-pattern "the guides say to wait for the notification" scripts/test/phase-runner-skill.test.mjs`

**C18** - Every input up to 100 MB, or malformed, gets a decision without a hook error (GPR-20)
Proof: `node --test --test-name-pattern "answers every input" .claude/hooks/test/gate-startup.test.mjs`

**C19** - The four rule modules load only when needed (GPR-21)
Proof: `node --test --test-name-pattern "loads rule modules only when needed" .claude/hooks/test/gate-startup.test.mjs`

**C20** - The gate's p95 over the F0 replay is at most 300 ms (GPR-22)
Proof: `node scripts/gate-bench.mjs`

**C21** - The corpus covers the four F0 friction rows (GPR-23)
Proof: `node --test --test-name-pattern "covers the F0 friction rows" scripts/test/gate-replay.test.mjs`

**C22** - The corpus holds nothing private (GPR-24)
Proof: `node --test --test-name-pattern "holds nothing private" scripts/test/gate-replay.test.mjs`

**C23** - Every replayed entry gets its category's decision, fixed in the test (GPR-25, GPR-26)
Proof: `node --test --test-name-pattern "replays F0 with the expected decisions" scripts/test/gate-replay.test.mjs`

**C24** - The harness suite passes with nothing removed or skipped (GPR-27)
Proof: `pnpm test:harness`

**C25** - No contract drift (GPR-28)
Proof: `pnpm contracts:check`

**C26** - The `harness-bootstrap` scenarios pass unchanged (GPR-29)
Proof: `pnpm exec turbo run test:acceptance -- --grep @HBS-`

**C27** - A secret name in any operand of a table command denies (GPR-30)
Proof: `node --test --test-name-pattern "denies a secret name in any operand" .claude/hooks/test/read-only.test.mjs`

**C28** - Nothing outside the checkout, or under another working directory, is allowed (GPR-31)
Proof: `node --test --test-name-pattern "allows nothing outside the checkout" .claude/hooks/test/read-only.test.mjs`

**C29** - A command word is judged by its last segment, and allowed only bare (GPR-32)
Proof: `node --test --test-name-pattern "judges a command word by its last segment" .claude/hooks/test/scripts.test.mjs`

**C30** - A package scope is not a ledger reference; every other form still denies (GPR-33)
Proof: `node --test --test-name-pattern "a package scope is not the ledger" .claude/hooks/test/budget-rules.test.mjs`

**C31** - Caps and the I/O deadline end in no `allow`, and in `ask` when a deny check timed out (design, security review)
Proof: `node --test --test-name-pattern "stops at its caps and its deadline" .claude/hooks/test/read-only.test.mjs`

**C32** - The acceptance scenarios pass (GPR-01 to GPR-33 with a scenario)
Proof: `pnpm exec turbo run test:acceptance -- --grep @GPR-`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-1 (T1 to T7) to `feature-worker` at `948bdaa`, 2026-11-08
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 → T2 → T3 → T4
Phase 2:  T4 → T5 → T6 → T7
Phase 3:  T7 → T8 → T9
Phase 4:  T9 → T10 → T11 → T12
Phase 5:  T12 → T13 → T14 → T15
Phase 6:  T15 → T16
```

Batches: `execute-batch-1` runs phases 1 and 2 (T1 to T7); `execute-batch-2` runs phases 3 and 4 (T8 to T12);
`execute-batch-3` runs phase 5 (T13 to T15); `execute-batch-4` runs phase 6 (T16), after `budget-v2` is merged into
`phase/F0` and `phase/F0` into this branch.
