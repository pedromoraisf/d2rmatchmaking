# Gate Precision Specification

**Approved**: 2026-11-08 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

Maintainer's own approval of this spec, 2026-11-08: "Aprovo a spec da Gate Precision." The `spec-reviewer` did not return PASS: six reviews (three after a maintainer reset) each found narrower cases, all fixed in this text; the maintainer approved it directly instead of a seventh review. The delegated line above is the form the gate accepts during a phase run; this paragraph is the approval's source.

**Amended by the runner** (assumed, AD-176; to confirm at the phase review): 2026-11-09. T16 found two examples of `acceptance.feature` that contradict other approved rules, and changed only those examples:

- GPR-01's `find . -name …` became `find apps -name …`. A start of `.` contains the git directory, which GPR-31 keeps out of a listing.
- GPR-33's first example became `pnpm --filter @d2rmm/api list`. The Background is a phase run, where `typecheck` outside the wrapper is denied by the sensor rule, not by the ledger rule GPR-33 is about.

No requirement text changes.

## Problem Statement

In F0 the gate asked for 89 read-only shell commands (15.7 hours of waiting; one reviewer waited 6 hours for a
`sed -n`), took 70 of its 83 "shell write to a harness file" asks from a `>` in `2>&1` or `2>/dev/null`, asked for
about 25 scripts it could have read, threw 8 "Invalid string length" errors, and timed out 44 times at 15 seconds.
Agents also polled: 7.9 hours of `sleep` and status loops, one worker checking status 1,204 times in 76 minutes. This
row makes the gate exact about what reads and what writes, judges what it can read, stops polling, and makes the gate
robust and fast, with a replay of F0's commands as the proof. Source: `.specs/phases/F0/brief-revision-6.md` § 1 and
§ 3 (gate-precision), approved by the maintainer on 2026-11-07; ADR 028; ADR 019.

## Goals

- [ ] A provably read-only command line gets `allow` from the gate; anything the gate cannot prove read-only and
      inside the checkout keeps today's decision.
- [ ] A read is never taken for a write; a real shell write to a protected file gets a decision that names the Edit tool.
- [ ] Polling is refused with an instruction to wait for the task notification.
- [ ] No input makes the gate throw or allow by mistake, and a cold gate call takes at most 300 ms at p95 over the
      F0 replay.

## Out of Scope

| Feature                                                                       | Reason                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Delivery commands, the `harness-self` scope and the merge guard               | `harness-bootstrap`, merged                                              |
| The retry-budget wrapper's filters, signatures, resets and messages           | `budget-v2`, brief revision 6                                            |
| The runner's remote flow                                                      | `continuous-delivery`, brief revision 6                                  |
| Changing the decision of a shell write to a self-protected file (stays `ask`) | HBS-23 of `harness-bootstrap`; its accepted scenario says `ask` (AD-157) |
| Raising the hook `timeout` in `.claude/settings.json`                         | The cause is the gate's own speed, fixed here                            |
| Any product behaviour: API, site, agent or contract changes                   | The row changes the gate, its tests, its fixtures and two guides         |

---

## Assumptions & Open Questions

| Assumption / decision                                   | Chosen default                                                                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                           | Confirmed?          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Which shell writes become a `deny` naming the Edit tool | Writes to harness and sensor files, the quality baseline and test files; a shell write to a self-protected file keeps `ask`                                                                                                                                                       | The brief turns the ask into a deny, and HBS-23's accepted scenario says `ask` for self-protected files. A test file can no longer be renamed with `mv`; the Edit tool writes it under its new name | n - AD-157, assumed |
| What "identical command" means for polling              | The hash of the trimmed Bash command string, in the same agent session, over a sliding 10 minutes, every Bash call counted (a denied one too); the history lives in its own file next to the ledger, pruned to 10 minutes                                                         | One exact rule; the session id already separates parallel workers (ADR 022); a hash keeps tokens out of the store; a separate file keeps clear of `budget-v2`'s ledger changes                      | n - AD-158, assumed |
| Where the replay corpus comes from                      | The F0 session transcripts under the maintainer's Claude Code project folder, read once by a committed extractor; home paths become `~`, scratchpad paths `<scratchpad>`; any entry with a secret, an e-mail address or a host other than `github.com` and `localhost` is dropped | The brief asks for "the F0 commands that prompted or were denied"; the transcripts record them; the repository is public                                                                            | n - AD-159, assumed |
| Where the 300 ms target is measured                     | A local benchmark over the corpus, cold `node` processes, on the phase machine; CI runs the replay's decisions, not its timing                                                                                                                                                    | Timing on shared CI runners is not repeatable; the target is about the agent's machine                                                                                                              | n - AD-160, assumed |
| A script read and then changed before it runs           | Accepted: the gate judges the file it reads; a change between the read and the run is not seen                                                                                                                                                                                    | The same holds for every untracked script the gate reads today; the agent that would change it is the one being gated, and its Edit calls are gated too                                             | n - AD-162, assumed |
| Recursive and pattern-file reads                        | Not read-only for GPR-01: `grep -r`, `grep -e`, `rg -g`/`--glob`, `rg -e`, `diff` on a directory, `awk` (named in the brief, dropped here), `sed` with a regular expression, and any content-reading command, `rg` included, on a directory: every read path is a regular file    | Each of those can reach a `.env` under a directory or hide what it reads; the read-only table keeps only forms whose every file read is a path operand the gate checks                              | n - AD-163, assumed |
| `git log -p` and `git show` with no path operand        | Read-only: they print the repository's history                                                                                                                                                                                                                                    | No secret is committed (`.gitignore`, gitleaks in CI and `pnpm secrets:scan` locally); the history is public on GitHub                                                                              | n - AD-164, assumed |

**Open questions:** none - all resolved or logged above.

---

## Definitions

- **Main checkout**: the parent directory of `git rev-parse --git-common-dir`.
- **Inside the checkout**: a path that, after resolving `..` and the symbolic links of its nearest existing directory,
  lies under the main checkout or under `.claude/worktrees/<feature>/`.
- **Path operand**: an operand a command reads as a file or directory, compared after quote removal: every non-option
  operand of `cat`, `head`, `tail`, `wc`, `ls`, `diff` and `git ls-files`; for `git diff`, `git log` and `git show`,
  the operands after `--` and the path half of a `<rev>:<path>` operand, while an operand before `--` that
  `git rev-parse --verify --quiet` resolves as a revision, or a range `A..B` or `A...B` whose ends resolve, is a
  revision and not a path, and any other operand before `--` is a path operand; the operands after the first of
  `grep` and of `rg` (every operand of `rg --files`); the starting points of `find`; and the operands after the script
  of `sed` and the filter of `jq`.
- **Options**: short options may be clustered (`-la`), each letter then being an option the table allows; a numeric
  value may be glued (`-A3`, `-n20`), and `head -20` reads as `head -n 20`; a long option may carry `=value` and is
  matched whole. After `--`, every word is a path operand.
- **Quoting**: a `$` inside single quotes is a literal character; a `$` unquoted or inside double quotes is an
  expansion. A backslash or a quote mark inside a path operand makes the line not an allowed shape.
- **Secret name**: matched ignoring letter case (macOS file systems ignore it), a path whose last segment matches `.env` or `.env.<anything>` other than `.env.example`, `.npmrc`,
  `.netrc`, `.git-credentials`, `id_rsa*`, `id_ed25519*`, `*.pem`, `*.key`, `credentials`, `hosts.yml`, `.dev.vars`,
  `.envrc`, `.pypirc`, `*.tfvars`, `*.env`, `.env~`, `*.pfx`, `*.p12`, `*.jks`, `terraform.tfstate`, or the git common directory itself or any path under it (its `d2rmm/` folder
  included); a trailing `/` or `/.` is removed before matching.
- **Safe word**: a line is split into words quote-aware: a single-quoted string is one word, inner spaces and `|`
  included; outside quotes, words split on whitespace after the operators `|` and `&&` and the four whole tokens
  `2>&1`, `>/dev/null`, `2>/dev/null` and `&>/dev/null` are taken out (inside quotes nothing is taken out). A word may
  be a run of unquoted safe characters and single-quoted strings (`-H'Accept: x'` is one word). A safe word is made only of letters, digits and
  `_ . / : @ % + = , -`, or is a single-quoted string with no `'` inside (anything may stand inside those quotes). Every
  word of an allowed-shape line is a safe word, so no unquoted glob, brace, `$`, backslash or double quote appears in
  it; a word of the form `NAME=value` before a command is an environment assignment, never a table segment, and makes
  the line not an allowed shape.
- **Read path**: a path operand of a command that reads file contents (`cat`, `sed`, `grep`, `rg` without `--files`,
  `head`, `tail`, `wc`, `diff`, `jq`, `git diff`, `git log`, `git show`). Every read path is an existing regular file —
  not a directory — inside the checkout, and neither the written path nor its resolved target (links followed) is a
  secret name or lies outside the checkout. For `<rev>:<path>`, the path is checked as written and as it would resolve
  in the working tree; it need not exist there. `grep` and `rg` need at least one read path, except a segment that
  follows a `|` and so reads its standard input. Path operands of `ls`, `find`, `rg --files` and `git ls-files`, which
  list names, may be directories inside the checkout that are not secret names and do not lie under the git common
  directory. `cd <dir>` refuses a `<dir>` that holds its own `.git` other than a `.claude/worktrees/<feature>` worktree,
  and `scripts/…` in a table row means `<root>/scripts/…` with `<root>` the main checkout or the feature worktree the
  line runs in: a `node scripts/…` segment after a `cd` into any other directory is not an allowed shape. In an
  allowed shape the command word is the bare spelling of its table row (`cat`, `git`, `gh`, `node`), with no `/`.
- **Allowed shape (read-only)**: the whole command line is segments of the read-only table below, joined only by `|`
  and `&&`, optionally preceded by `cd <dir> &&` with `<dir>` a literal path inside the checkout; `echo` segments with
  literal words; and no redirection other than the whole tokens `2>&1`, `>/dev/null`, `2>/dev/null` and `&>/dev/null`.

### Read-only table

Each command takes only the options listed for it; any other option, a glued form of an unlisted option
(`-XPOST`, `--method=POST`), or a global option of `git` (`-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path`)
makes the line not an allowed shape.

| Command                                                                                | Options allowed                                                                                                                                                                                                            | Further conditions                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cat`                                                                                  | `-n`                                                                                                                                                                                                                       |                                                                                                                                                                                                          |
| `sed`                                                                                  | `-n` (required)                                                                                                                                                                                                            | one script operand that is `Np`, `N,Mp` or `$p` with `N` and `M` line numbers; no regular expression                                                                                                     |
| `grep`                                                                                 | `-n`, `-i`, `-E`, `-F`, `-v`, `-c`, `-l`, `-w`, `-o`, `-A N`, `-B N`, `-C N`, `-m N`                                                                                                                                       | the pattern is the first operand; no `-e`, `-r`, `-R`, `--recursive`, `-f`, `--file` (AD-163)                                                                                                            |
| `rg`                                                                                   | `-n`, `-i`, `-S`, `-F`, `-w`, `-l`, `-c`, `-A N`, `-B N`, `-C N`, `-t T`, `--files`                                                                                                                                        | the pattern is the first operand; no `-e`, `-g`, `--glob`, `--pre`, `--hostname-bin`, `--hidden`, `-u`, `--no-ignore`, `-z`, `--search-zip`                                                              |
| `head`, `tail`                                                                         | `-n N`, `-c N`                                                                                                                                                                                                             | no `-f`, `-F`, `--follow`, `--pid`                                                                                                                                                                       |
| `wc`                                                                                   | `-l`, `-w`, `-c`, `-m`                                                                                                                                                                                                     |                                                                                                                                                                                                          |
| `ls`                                                                                   | `-l`, `-a`, `-A`, `-h`, `-R`, `-1`, `-t`, `-r`, `-S`, `-d`                                                                                                                                                                 |                                                                                                                                                                                                          |
| `find`                                                                                 | predicates `-name`, `-iname`, `-path`, `-type`, `-maxdepth`, `-mindepth`, `-not`, `!`, `-o`, `-a`, `(`, `)`, `-newer`, `-size`, `-mtime`, `-empty`, `-prune`, `-print`, `-print0`                                          | any other predicate (`-exec`, `-delete`, `-fls`, `-fprint`…) is outside the table                                                                                                                        |
| `jq`                                                                                   | `-r`, `-c`, `-e`, `-s`, `-S`, `-n`, `--arg N V`                                                                                                                                                                            | one filter operand with none of the words `env`, `$ENV`, `input`, `inputs`, `input_filename`, `include`, `import`, `$__loc__`                                                                            |
| `diff`                                                                                 | `-u`, `-U N`, `-q`, `-b`, `-w`                                                                                                                                                                                             | file operands only; a directory operand makes the line not an allowed shape                                                                                                                              |
| `git status`                                                                           | `--short`, `-s`, `--branch`, `-b`, `--porcelain`                                                                                                                                                                           |                                                                                                                                                                                                          |
| `git rev-parse`                                                                        | `--short`, `--abbrev-ref`, `--show-toplevel`, `--git-common-dir`, `--verify`, `--quiet`                                                                                                                                    |                                                                                                                                                                                                          |
| `git ls-files`                                                                         | `--others`, `-o`, `--exclude-standard`, `--error-unmatch`, `--cached`, `-c`                                                                                                                                                |                                                                                                                                                                                                          |
| `git diff`, `git log`, `git show`                                                      | `--stat`, `--shortstat`, `--name-only`, `--name-status`, `--oneline`, `-n N`, `-N` (a number), `--format=F`, `--pretty=F`, `--graph`, `--decorate`, `-p`, `--patch`, `--cached`, `--staged`, `--no-color`, `--color=never` | an option is matched whole, so an abbreviation (`--out`) is not on the list                                                                                                                              |
| `git branch`                                                                           | `--list`, `-a`, `-r`, `-v`, `-vv`, `--show-current`, `--contains C`, `--merged`                                                                                                                                            | listing only: no positional operand other than the value of `--contains`                                                                                                                                 |
| `git fetch`                                                                            | `--prune`, `--tags`, `-q`                                                                                                                                                                                                  | remote `origin` only; refspecs without `:`; no `--upload-pack`                                                                                                                                           |
| `gh run view`, `gh run list`, `gh pr view`, `gh pr list`, `gh pr checks`, `gh pr diff` | `--json F`, `-L N`, `--limit N`, `--state S`, `--head B`, `--base B`, `--log`, `--log-failed`, `--name-only`, `--required`                                                                                                 | no `--jq`, `-q`, `--template`, `-t`, `--web`, `-w`, `--watch`, `--repo`, `-R`                                                                                                                            |
| `gh api`                                                                               | `-H` with an `Accept:` or `X-GitHub-Api-Version:` value only, `--paginate`, `-X GET`, `--method GET`                                                                                                                       | the endpoint is a `repos/…` or `/repos/…` path with no scheme or host; no `--hostname`, `--jq`, `-q`, `--template`, `-f`, `-F`, `--field`, `--raw-field`, `--input`, and no other method in any spelling |
| `node scripts/phase-status.mjs`                                                        | `--json`, and one operand matching `F` followed by digits                                                                                                                                                                  |                                                                                                                                                                                                          |
| `node scripts/attempt.mjs status`, `node scripts/attempt.mjs report`                   | `--feature F`                                                                                                                                                                                                              |                                                                                                                                                                                                          |

---

## User Stories

### P1: Read-only commands pass without a prompt ⭐ MVP

**User Story**: As an agent, I want provably read-only commands inside the checkout to be allowed so that I never wait on a prompt to read a file.

**Why P1**: 89 prompts and 15.7 hours of waiting in F0.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. GPR-01: WHEN a Bash command line is an allowed shape (read-only), every word is a safe word, every read path is an existing regular file inside the checkout that is not a secret name, and every other path operand is inside the checkout, outside the git common directory and not a secret name THEN the gate SHALL answer `allow`
2. GPR-02: The read-only commands and their options SHALL be exactly those of the read-only table
3. GPR-03: IF a command line holds a newline or carriage return, `;`, `||`, a single `&`, `|&`, a `$` that is not inside single quotes, a backtick, `<(`, `>(`, `<`, `<<`, `<<<`, `>|`, `>&<word>`, a subshell, an unquoted `~`, `{` or `}`, an unquoted `*`, `?` or `[` in a path operand, or a `*`, `?`, `[` or leading `:` in a path operand of a `git` command, quoted or not THEN GPR-01 SHALL NOT apply, and the line SHALL get the decision it gets today
4. GPR-04: WHEN another rule denies or asks for a command line that GPR-01 would allow THEN the gate SHALL give that rule's decision
5. GPR-30: IF a segment whose command is in the read-only table has a non-option operand, an option value, or a `<rev>:<path>` path that is a secret name, whatever its other options THEN the gate SHALL deny it; this is deliberate even for a pattern that only looks like one (`grep .env README.md`), since the gate cannot tell a pattern from a path once options are unknown
6. GPR-31: IF a path operand is outside the checkout THEN GPR-01 SHALL NOT apply

**Independent Test**: feed the gate `cd apps && rg -n foo api/package.json 2>/dev/null | head -n 20` and read `allow`; feed `rg -n foo apps` (a directory) and read no `allow`; feed `grep KEY apps/api/.env` and read `deny`.

---

### P1: A read is never a write ⭐ MVP

**User Story**: As an agent, I want `2>&1` and `2>/dev/null` to stop looking like writes so that reading a harness file never asks.

**Why P1**: 70 of the 83 shell-write asks in F0 were reads.

**Acceptance Criteria**:

1. GPR-05: The gate SHALL take as a shell write an output redirection (`>`, `>>`, `&>`, `N>`, `N>>`, `>|`, `>&<file>`) whose target is a file, `tee` with a file operand, `sed -i` or `--in-place`, `perl -i`, `truncate`, `install` with a file operand, and `cp`, `mv` and `ln`, where a protected path as the source of `mv` or `ln` or as any operand of `cp` counts as a write; `dd of=`, `curl -o`, `wget -O`, `patch` and `git apply` keep today's decision
2. GPR-06: The gate SHALL NOT take as a write target `/dev/null`, `/dev/stdout`, `/dev/stderr`, `&1` or `&2`, nor a `>` inside single or double quotes of the command line itself; text passed to `sh -c`, `bash -c`, `eval`, `xargs`, `find -exec` or inline code SHALL still be judged as commands or code
3. GPR-07: WHEN a command line reads a harness, sensor or self-protected file and its only redirections are of GPR-06 THEN the gate SHALL NOT ask or deny for a write
4. GPR-08: IF a shell write targets a harness or sensor file, the quality baseline or a test file THEN the gate SHALL deny it, and the reason SHALL say to use the Edit tool (AD-157)
5. GPR-09: IF inline code (`python3 -c`, `python3 -` with a here-doc, `node -e`, `node -` with a here-doc, `perl -e`) or a script judged by its content (GPR-11) writes a file GPR-08 names THEN the gate SHALL deny it with the same instruction; other interpreters keep today's decision
6. GPR-10: IF a shell write, inline code or a script writes a self-protected file THEN the gate SHALL keep today's `ask` (HBS-23, AD-157)

**Independent Test**: feed the gate `cat .claude/hooks/gate.mjs 2>&1 | head -n 5` and read no ask; feed `echo x > eslint.config.mjs` and read a deny that names the Edit tool.

---

### P1: Scripts the gate can read are judged by what they hold ⭐ MVP

**User Story**: As an agent, I want a script I wrote in the session scratchpad to be judged by its content so that the gate does not ask merely because it lives outside the repository.

**Why P1**: about 25 asks for scripts outside the repository in F0.

**Acceptance Criteria**:

1. GPR-11: WHEN a command runs a script outside the repository that is a regular text file of at most 1 MB with a shebang or a `.sh`, `.bash`, `.zsh`, `.py`, `.js`, `.mjs`, `.rb` or `.pl` extension THEN the gate SHALL give it the decision its content gets, as for an untracked script inside the repository: a deny or an ask its content triggers, `allow` when it is a shell script whose every line, other than the shebang, comments, blank lines and `set -e`/`set -eu`/`set -euo pipefail`, is an allowed shape (read-only) under GPR-01 with operands resolved against the call's working directory, and no opinion otherwise
2. GPR-12: IF the script cannot be read, is not such a text file (a binary, a FIFO, a device, a larger file), or runs or sources another file outside the checkout THEN the gate SHALL ask
3. GPR-13: The gate SHALL take a token as a script only when it is the command word and names a text file of GPR-11, or the first operand that is not an option of `bash`, `sh`, `zsh`, `python`, `python3`, `node`, `ruby` or `perl`; `//`, `/**`, a token with `*`, `?`, `[`, `(` or `|`, and the argument of `-e`, `-c`, `--grep` or `-E` SHALL never be scripts
4. GPR-32: The gate SHALL judge a command word by its last path segment for its deny and ask rules, so `/bin/rm` gets the decision of `rm`; the allow of GPR-01 needs the bare table spelling, so `./git log` and `/tmp/cat a.txt` never get `allow` from it
5. GPR-33: IF the only occurrence of `d2rmm/` in a command is a package scope (`@d2rmm/<name>`) THEN the ledger and verdicts rule (HBS-31) SHALL NOT deny it; every other `d2rmm/`, `verdicts.json`, `ledger.json` and `cd` into `.git` keeps its deny

**Independent Test**: write a read-only shell script to the scratchpad, run it, and read `allow`.

---

### P1: Asking a sensor for help is not running it ⭐ MVP

**User Story**: As an agent, I want `--help` on a sensor to pass so that learning a flag does not spend a denial.

**Why P1**: help calls were denied as sensor runs outside the wrapper.

**Acceptance Criteria**:

1. GPR-14: WHEN the whole command line is one sensor command whose only argument after the tool name (`vitest`, `playwright`, `stryker`, `eslint`, `tsc`, `depcruise`, `cargo nextest`, `cargo clippy`, `cargo mutants`, invoked directly or through `pnpm exec`, `npx` or `cargo`) is `--help`, `-h`, `--version` or `--list` THEN the gate SHALL NOT apply the wrapper rule to it on phase and feature branches; `pnpm <script> --help` and a help call in a pipe are not covered

**Independent Test**: feed the gate `pnpm exec vitest --help` on a feature branch and read no deny.

---

### P1: No polling ⭐ MVP

**User Story**: As the maintainer, I want agents to wait for task notifications instead of polling so that hours are not spent in `sleep` loops.

**Why P1**: 7.9 hours of polling in F0; one worker made 1,204 status checks in 76 minutes.

**Acceptance Criteria**:

1. GPR-15: IF the `sleep` durations of a command line, nested `sh -c`/`bash -c` text included, add up to more than 30 seconds, or a `sleep` argument is `infinity`, not a decimal number with an optional `s`, `m`, `h` or `d` suffix (`1e2` is not), or not a literal THEN the gate SHALL deny it; a number with no suffix or with `s` is seconds, and `m`, `h` and `d` are minutes, hours and days
2. GPR-16: IF a command holds a `for`, `until` or `while` loop whose body runs `sleep` THEN the gate SHALL deny it
3. GPR-17: IF the same Bash command string, trimmed, is run for the fifth time within 10 minutes in one agent session THEN the gate SHALL deny it, every Bash call counting, a denied one included (AD-158)
4. GPR-18: WHEN the gate denies under GPR-15 to GPR-17 THEN the reason SHALL say to run long work in the background and wait for its task notification
5. GPR-19: `.claude/agents/feature-worker.md` and the phase-runner `SKILL.md` SHALL say to run long work in the background and wait for its notification, and never to poll

**Independent Test**: feed the gate `sleep 60` and read the deny; feed the same `git status` five times in one session and read the fifth deny.

---

### P1: Robust and fast ⭐ MVP

**User Story**: As every agent, I want the gate to answer every call quickly and never fail so that no call stalls on a timeout or falls back to a prompt.

**Why P1**: 44 timeouts at 15 seconds and 8 "Invalid string length" errors in F0.

**Acceptance Criteria**:

1. GPR-20: WHEN the gate receives a tool call of any size up to 100 MB, or a malformed one THEN it SHALL return a decision or no opinion without reporting a gate hook error, SHALL apply its path rules before reading content, and SHALL never answer `allow` from a part of the input
2. GPR-21: The gate SHALL load the ratchet, acceptance, mutation-scope and model-policy modules only when a call needs a rule that uses them
3. GPR-22: WHEN `node scripts/gate-bench.mjs` replays every corpus entry three times, each as a cold `node .claude/hooks/gate.mjs` process THEN the 95th percentile of those call times SHALL be at most 300 ms, and the script SHALL exit non-zero otherwise (AD-160)

**Independent Test**: run the benchmark and read the p95.

---

### P1: The F0 replay is the proof ⭐ MVP

**User Story**: As the maintainer, I want F0's prompted and denied commands replayed through the new gate so that the asks this row removes are shown gone, and the ones ADR 028 keeps are shown kept.

**Why P1**: brief revision 6 § 4 makes the replay the proof of the gate's exit criterion.

**Acceptance Criteria**:

1. GPR-23: `scripts/test/fixtures/gate-replay.json` SHALL hold the F0 tool calls that got `ask` or `deny` from the gate or a permission prompt, one entry per distinct normalised call, each with a category, and at least one entry for each of the friction rows of brief revision 6 § 1 labelled "Permission prompts for read-only shell commands", "Shell write to a harness/sensor file on reads", "Asks for scripts outside the repo, gate errors" and "Polling and sleep"; the row "Gate timeouts" is proved by GPR-22 (AD-159)
2. GPR-24: The corpus SHALL hold no home path (`/Users/<name>`), no session scratchpad path, no e-mail address, no host other than `github.com` and `localhost`, and nothing `pnpm secrets:scan` flags
3. GPR-25: WHEN the replay test runs THEN every entry's decision SHALL equal the expected decision of its category
4. GPR-26: The expected decision of each category SHALL be fixed in the replay test, not in the corpus: `allow` for read-only commands and for push, PR, merge, release and workflow commands of the allowed shapes; `deny` for secret reads, the ledger, force pushes and the other denies of ADR 019 and ADR 028; `ask` for secrets and variables, repository settings, shell writes to self-protected files and the other maintainer items of ADR 028 § 1

**Independent Test**: run the replay test.

---

### P1: Nothing else changes

**User Story**: As the maintainer, I want this row to leave the product alone and every test intact.

**Why P1**: brief revision 6 is harness-only.

**Acceptance Criteria**:

1. GPR-27: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped
2. GPR-28: WHEN `pnpm contracts:check` runs on the feature's head THEN the system SHALL report no drift (ADR 020)
3. GPR-29: WHEN the acceptance scenarios of `harness-bootstrap` run on the feature's head THEN they SHALL pass unchanged

**Independent Test**: run the three commands.

---

## Edge Cases

- GPR-03 covers `cat a` and `rm b` on two lines, `cat $(ls)`, `ls > out.txt`, `grep x <(cat y)` and `cat .e*`.
- GPR-06 covers `echo "a > b"`, `grep '>' file` and `bash -c "echo x > eslint.config.mjs"` (judged as a write).
- GPR-13 covers `rg '//' src`, `ls /**` and `git log --grep '/fix/'`; those lines prove only that the token is not
  taken as a script (`--grep` is not in the `git log` row, so that line is not an allowed shape).
- The `find` row's `!`, `(` and `)` are written single-quoted to be safe words.
- GPR-15 covers `sleep 30` (allowed), `sleep 31`, `sleep 1m`, `sleep 20 && sleep 20`, `sleep infinity` and `sleep $N`.
- GPR-17 covers the fourth identical call (allowed) and a fifth after 10 minutes (allowed).
- GPR-30 covers `grep K apps/api/.env`, `grep -e K apps/api/.env`, `git show HEAD:.env`, `git log -p -- .npmrc` and
  `jq . .npmrc`; GPR-31 covers `cat ~/.ssh/id_rsa`, `cat /proc/self/environ` and `git diff --no-index`.
- The `jq` and `gh api --jq` rows cover `jq -n env` and `gh api x --jq env`; their banned words are matched as whole
  words (`.environment` is allowed). `awk` is not in the table.
- The quoting rule covers `grep 'x$' a.txt` and `sed -n '$p' a.txt` (allowed) and `cat .e""nv` and `cat .\env`
  (not allowed).
- GPR-03 covers `cat .en{v,v}`, `git log -p -- '.e*'`, `git ls-files ':(glob).e*'`; the table covers `git log --out=x`
  (an abbreviation, refused), `rg KEY -g .env .`, `diff -r a b` and `sed -n '/x/p;w o/p' f` (refused); the secret
  rule covers `cat .ENV` and `cat apps/api/.Env.local` (denied).
- GPR-32 covers `/bin/rm -rf apps`.

---

## Requirement Traceability

| Requirement ID | Story                          | Phase  | Status  |
| -------------- | ------------------------------ | ------ | ------- |
| GPR-01         | P1: Read-only commands pass    | Design | Pending |
| GPR-02         | P1: Read-only commands pass    | Design | Pending |
| GPR-03         | P1: Read-only commands pass    | Design | Pending |
| GPR-04         | P1: Read-only commands pass    | Design | Pending |
| GPR-05         | P1: A read is never a write    | Design | Pending |
| GPR-06         | P1: A read is never a write    | Design | Pending |
| GPR-07         | P1: A read is never a write    | Design | Pending |
| GPR-08         | P1: A read is never a write    | Design | Pending |
| GPR-09         | P1: A read is never a write    | Design | Pending |
| GPR-10         | P1: A read is never a write    | Design | Pending |
| GPR-11         | P1: Scripts judged by content  | Design | Pending |
| GPR-12         | P1: Scripts judged by content  | Design | Pending |
| GPR-13         | P1: Scripts judged by content  | Design | Pending |
| GPR-14         | P1: Sensor help                | Design | Pending |
| GPR-15         | P1: No polling                 | Design | Pending |
| GPR-16         | P1: No polling                 | Design | Pending |
| GPR-17         | P1: No polling                 | Design | Pending |
| GPR-18         | P1: No polling                 | Design | Pending |
| GPR-19         | P1: No polling                 | Design | Pending |
| GPR-20         | P1: Robust and fast            | Design | Pending |
| GPR-21         | P1: Robust and fast            | Design | Pending |
| GPR-22         | P1: Robust and fast            | Design | Pending |
| GPR-23         | P1: The F0 replay is the proof | Design | Pending |
| GPR-24         | P1: The F0 replay is the proof | Design | Pending |
| GPR-25         | P1: The F0 replay is the proof | Design | Pending |
| GPR-26         | P1: The F0 replay is the proof | Design | Pending |
| GPR-27         | P1: Nothing else changes       | Design | Pending |
| GPR-28         | P1: Nothing else changes       | Design | Pending |
| GPR-29         | P1: Nothing else changes       | Design | Pending |
| GPR-30         | P1: Read-only commands pass    | Design | Pending |
| GPR-31         | P1: Read-only commands pass    | Design | Pending |
| GPR-32         | P1: Scripts judged by content  | Design | Pending |
| GPR-33         | P1: Scripts judged by content  | Design | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 33 total, 33 mapped to design, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 1, § 3 (gate-precision) and § 4 - the scope and the replay exit criterion, approved by the maintainer ("Aprovo a revisão do ADR 028.")
- ADR 019 - the gate hook and its rules (GPR-01 to GPR-21, GPR-30 to GPR-32)
- ADR 028 § 1 - the decisions the replay expects (GPR-23 to GPR-26)
- ADR 022 - agent sessions and the ledger (GPR-17)
- ADR 020 - contract drift (GPR-28)
- `AGENTS.md` rule 6 - secrets stay out of the agent's reach (GPR-30, GPR-31)
- `docs/product/prd.md#NFR-11` - harness verified in CI (GPR-22 to GPR-27, GPR-29)
- `.specs/features/harness-bootstrap/spec.md` HBS-23 - the decision for self-protected shell writes (GPR-10)

---

## Success Criteria

- [ ] The rows after this one show no prompt for a read-only command and no "Shell write" ask for a read.
- [ ] No gate timeout and no "Gate hook error" in the rest of the phase.
