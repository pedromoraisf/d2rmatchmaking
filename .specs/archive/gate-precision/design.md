# Gate Precision Design

**Spec**: `.specs/features/gate-precision/spec.md`
**Status**: Accepted — architecture review PASS; security review PASS after a maintainer reset (2026-11-08)

---

## Architecture Overview

The gate stays one PreToolUse process (`.claude/hooks/gate.mjs`) that calls the pure `decide(input, ctx)` and applies
its effects. This row adds four pure modules and one store, and changes how `gate.mjs` starts:

```
stdin ──► gate.mjs ── read bounded input (Buffer) ── pick rule modules by tool ──► decide(input, ctx) ──► effects
                                                                                    │
            ┌───────────────────────────────────────────────────────────────────────┤
            ▼                       ▼                         ▼                      ▼
     shell-parse.mjs         read-only.mjs              writes.mjs             polling.mjs
     (tokens, segments,      (table, path operands,     (write targets,        (sleep sum, loops,
      redirections, quotes)   secrets, inside checkout)  Edit-tool denial)      repetition)
                                                                                    │
                                                                         history-store.mjs (.git/d2rmm/history.json)
```

Order inside `checkBash` (deny beats ask beats allow, GPR-04):

1. Existing hard denies (production database, `--no-verify`, mutation scope, ledger and verdicts, force push…).
2. `polling.mjs`: sleep sum, loops, fifth identical call → deny (GPR-15 to GPR-17).
3. `writes.mjs`: shell writes to protected files → deny naming the Edit tool, or `ask` for self-protected files
   (GPR-05 to GPR-10); secret reads by any table command → deny (GPR-30).
4. Existing segment rules, indirections and scripts (now with GPR-11 to GPR-13, GPR-32), delivery and the guard.
5. Only when steps 1 to 4 gave no opinion: `read-only.mjs` → `allow` (GPR-01 to GPR-03, GPR-31).

Every module is pure: `ctx` carries `root`, `mainRoot`, `readFile`, `realpath`, `stat`, `git`, `now`, `ledger`,
`verdicts` and `history`. `gate.mjs` is the only place with I/O.

### Approaches considered (Large)

| Approach                                                                        | Pros                                                                                                             | Cons                                                                                   | Chosen  |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| A. Extend the regexes of `checkSegments`                                        | Small diff                                                                                                       | The F0 false positives came from regexes on raw text; quotes and `2>&1` stay ambiguous | no      |
| B. One shell tokenizer feeding every new rule; existing rules keep their inputs | Exact quotes, operators and redirections; old rules untouched, so `harness-bootstrap`'s tests and scenarios hold | Two ways to read a line live side by side for now                                      | **yes** |
| C. Rewrite every rule on the new tokenizer                                      | One model                                                                                                        | Re-proves every accepted rule of F0 and `harness-bootstrap` in one row                 | no      |

## Code Reuse Analysis

### Existing Components to Leverage

| Component                                                               | Location                                  | How to Use                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `indirections`, `innerShellCommands`, `shellWords`                      | `.claude/hooks/lib/shell-indirection.mjs` | Nested text (`bash -c`, `eval`, here-docs) is still found here; the new rules run on each nested command too (GPR-06) |
| `isHarnessFile`, `isSelfProtected`, `TEST_FILE`, `BASELINE`, `ENV_FILE` | `.claude/hooks/lib/gate-rules.mjs`        | Exported and reused by `writes.mjs` and `read-only.mjs`; no list is copied                                            |
| `insideRepo`, `resolveInside`, `mainCheckout`                           | `.claude/hooks/lib/io.mjs`                | "Inside the checkout" (GPR-31, `cd <dir>`)                                                                            |
| `checkScript`, `checkInlineCode`                                        | `gate-rules.mjs`                          | Extended for GPR-09, GPR-11, GPR-12                                                                                   |
| `runsSensor`                                                            | `.claude/hooks/lib/budget-rules.mjs`      | One exemption for help calls (GPR-14)                                                                                 |
| `withLedger` lock                                                       | `scripts/lib/ledger-store.mjs`            | Same lock pattern for the history store                                                                               |
| `sessionId`                                                             | `scripts/lib/budget.mjs`                  | Session key for repetition (GPR-17)                                                                                   |

### Integration Points

| System                     | Integration Method                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code PreToolUse     | Unchanged registration; `gate.mjs` answers faster and never throws                                                                                                                                    |
| `budget-v2` (parallel row) | Both touch `budget-rules.mjs`; this row only adds the help exemption inside `runsSensor`, and keeps its store out of `budget.mjs` and the ledger (AD-158). Conflicts are resolved at the second merge |
| `harness-bootstrap` rules  | Untouched; GPR-29 replays their scenarios                                                                                                                                                             |

## Components

### shell-parse.mjs

- **Purpose**: turn a command line into segments, each with words (text, quoted or not, with or without an
  expansion) and redirections, and the operators between segments.
- **Interfaces**:
  - `parseLine(text): { segments: Segment[], operators: string[], unsafe: string[] }` — quote-aware: a single-quoted
    string is one word (inner spaces and `|` included); operators and the four redirection tokens are recognised only
    outside quotes. `unsafe` lists every shape of GPR-03 found (newline, `;`, `||`, single `&`, `|&`, unquoted or
    double-quoted `$`, backtick, `<(`, `>(`, `<`, `<<`, `<<<`, `>|`, `>&word`, subshell, unquoted `~`, `{`, `}`, a
    glob in a word, a glob or leading `:` in a git path operand).
  - `expandOptions(words, spec)`: clusters and glued values per the spec's Options paragraph.
- **Dependencies**: none.
- **Reuses**: none (the old `splitCommands` stays for old rules).
- **Fail-closed**: any input it cannot tokenize (unbalanced quote, input over 2 MB) returns `unsafe: ['unparsed']`.

### read-only.mjs

- **Purpose**: the read-only table, safe words, path operands and read paths, secret names, and the `allow` of GPR-01.
- **Interfaces**:
  - `READ_ONLY_TABLE` (data, one entry per row of the spec's table: allowed options, operand rules, extra checks).
  - `isSafeWord(word)`; `pathOperands(segment, ctx)` (revisions of `git diff/log/show` resolved with
    `git rev-parse --verify --quiet`); `isSecretName(path, ctx)` (case-insensitive, trailing `/` and `/.` removed,
    the git common directory and everything under it); `isReadPath(path, ctx)` (an existing regular file inside the
    checkout, the written path and its resolved target both checked); `readOnlyDecision(parsed, ctx)` → `allow`,
    `deny` (a secret name, GPR-30) or `null`.
- **Rules it enforces in order**: bare command word (no `/`, GPR-32); every word safe, and no word starting with `=`;
  no environment assignment; options in the row's allow-list, matched whole after cluster expansion, and numeric
  option values (`head -n`, `-A`, `-m`, `tail -n +N`) digits only; the working directory (below); `cd <dir>`
  resolved with `realpath`, inside the checkout and not into a nested repository; `scripts/…` resolved at the root
  the line runs in; every read path a regular file with one link (`nlink` 1) and not ignored by git; `find -newer F`
  and `<rev>:<path>` paths checked as read paths after normalising `./` and `..`; listing commands
  (`ls -R`, `find`) refused when a start point contains the git common directory; then `allow`.
- **Working directory**: every relative operand, every `realpath`/`stat` and every `git` spawn resolves against
  `input.cwd`, or against the target of a leading `cd`. `input.cwd`, resolved with `realpath`, must be a directory
  inside the checkout with no `.git` entry of its own between it and the checkout root (a nested repository).
  Otherwise, or when `input.cwd` is missing, there is no `allow`.
- **Caps**: at most 200 words, 64 path operands and 8 `git` spawns per line. Over a cap there is no `allow`.
  `git` runs with `execFileSync` (an argument array, no shell), `--end-of-options` before revisions,
  `-c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0` and `killSignal: 'SIGKILL'`, set once in the `git` wrapper of
  `io.mjs`, so a helper holding the pipes cannot keep the spawn alive past its timeout.
- **I/O deadline**: `decide` stays synchronous, so a timer cannot interrupt a spawn in flight. `gate.mjs` therefore
  gives `ctx` one deadline for the whole call, 5 s after start-up. Every `git` spawn, `realpath`, `stat` and
  `readFile` through `ctx` checks it before it starts. A `git` spawn also runs with a timeout of
  `min(2 s, time left)`; Node's synchronous `fs` calls take no timeout, so an `fs` call already in flight on a hung
  network mount is not interrupted (accepted residual: the checkout is local). When the deadline has passed, or a
  spawn times out, the call ends with no `allow`, or with `ask` when a deny rule still needed that I/O to decide.
  The worst case is therefore about 5 s plus one 2 s spawn, well under the 15 s hook timeout; the watchdog below is
  only a backstop. A unit test with a fake clock pins the deadline, and one with a slow fake `git` pins the `ask`.
- **Reading a file**: open with `O_RDONLY | O_NONBLOCK` (never blocks on a FIFO), `fstat` the descriptor, require a
  regular file with `nlink` 1 and at most 1 MB, then read from the same descriptor. No `stat`-then-`readFile`
  race; the same helper serves `scriptKind`'s 1 MB cap.
- **No `allow` is no opinion**: when no deny rule needed the timed-out I/O, the gate gives no opinion and the
  permission mode decides, as it does today for any line the gate does not judge. Ignored paths are found with one batched `git check-ignore --stdin` per
  line, which also covers secret names missing from the spec's list (`.gitignore` already holds `.env*`, `*.pem`,
  `*.key`, `*.pfx`).
- **Dependencies**: `shell-parse.mjs`, `io.mjs`.
- **Reuses**: `ENV_FILE`.

### writes.mjs

- **Purpose**: find shell writes and judge their targets (GPR-05 to GPR-10).
- **Interfaces**: `writeTargets(parsed): { path, how }[]`; `writeDecision(parsed, ctx)` → `deny` with "use the Edit
  tool", `ask` for self-protected targets, or `null`.
- **Dependencies**: `shell-parse.mjs`, the protected-path predicates of `gate-rules.mjs`.

### polling.mjs and history-store.mjs

- **Purpose**: GPR-15 to GPR-18.
- **Interfaces**: `sleepSeconds(parsed)` → number or `Infinity`; `pollingLoop(parsed)` → boolean;
  `repeatDecision(command, sid, history, now)` → `deny` or `null` plus the effect `{ op: 'history', sid, hash, at }`.
  `history-store.mjs`: `loadHistory(file)`, `withHistory(file, fn)` (lock, prune entries older than 10 minutes).
- **Store**: `.git/d2rmm/history.json`, `{ version: 1, sessions: { [sid]: [{ hash, at }] } }`; `hash` is SHA-256 of
  the trimmed command. The `d2rmm/` folder is already out of the agent's reach (HBS-31). The path comes from the git
  common directory, as `ledgerPath()` resolves it (in a worktree `.git` is a file). The lock waits at most 200 ms and
  breaks a lock older than 10 s; the file is written with mode 0600 and capped at 50 entries per session and 64
  sessions. A corrupt file is moved to a single `history.json.corrupt`, overwritten each time.
- **Fails open on purpose**: a locked or corrupt store gives no polling deny for that call. The polling deny is a
  nudge, not a security rule; every other rule still runs.
- **Deny text**: one exported constant shared by GPR-15 to GPR-17, pinned by a unit test.

### Scripts (gate-rules.mjs)

- **Purpose**: GPR-11 to GPR-13 and GPR-32.
- **Interfaces**: `scriptKind(path, ctx)` → `text-shell`, `text-code` or `other` (regular file, ≤ 1 MB, no NUL
  byte). `text-shell` only when the shebang is exactly `#!/bin/sh`, `#!/bin/bash`, `#!/bin/zsh` or
  `#!/usr/bin/env sh|bash|zsh` with no argument, or there is no shebang and the extension is `.sh`; and the invoking
  word is a shell (`bash`, `sh`, `zsh`) or the script itself. `python3 x.sh` or `node x.sh` never gets the shell
  verdict. A shell script is parsed line by line, skipping the shebang, comments (a comment ending in `\` or `'`
  changes nothing), blank lines and `set -e` forms; `basename` of the command word for every rule.
- **`node scripts/…` rows**: allowed only because every `scripts/` file the table names is a harness or
  self-protected file the agent cannot edit without a decision; a unit test pins that for each one.

### gate.mjs start-up

- **Purpose**: GPR-20 and GPR-21.
- **Watchdog (backstop)**: the first statement arms an 8 s timer that writes `ask` ("the gate ran out of time") and
  exits 0. It covers the asynchronous parts (stdin, `import()`); the synchronous part is bounded by the I/O deadline
  of `read-only.mjs`. A Claude Code hook timeout lets the call through, so the gate must answer before it; the hook
  `timeout` stays as it is.
- **Deny scans first**: the rules that spawn nothing (secret names, ledger and verdicts, writes, polling) run before
  any rule that spawns `git` or calls `realpath`/`stat`, so a slow line cannot hide a later deny.
- Reads stdin into a `Buffer`; over 100 MB it answers `ask` without parsing. Parses JSON once; a parse failure answers
  `ask` with a log line, never a hook error and never no opinion (in an auto mode no opinion lets the call run).
- Loads `ratchet`, `acceptance`, `mutation-scope` and `model-policy` with `import()` only for the tools and paths
  that need them (an Edit of the baseline, an Edit of a `.feature` file, a mutation run, a dispatch), and passes them
  to `decide` in `ctx.modules`; `decide` stays synchronous. This removes the static imports of `ratchet`,
  `acceptance` and `mutation-scope` from `gate-rules.mjs` (and of `model-policy` from where it is imported today);
  a unit test checks the module graph no longer loads them eagerly. A failed `import()` answers `ask`.
- Log lines never contain the command or the raw input.
- Path rules (`.env`, vendored, migrations, the `d2rmm/` folder) run before any content rule; a content rule on
  content over 10 MB answers `ask` instead of judging a part (never `allow`).

### Replay and benchmark

- `scripts/gate-replay/extract.mjs` (run once, by hand, not in CI): reads the F0 transcripts, keeps tool calls whose
  result is a gate deny or ask or a permission prompt, assigns a category, and writes
  `scripts/test/fixtures/gate-replay.json`. It keeps by **allow-list**, never by deny-list:
  - `Bash`: the command is re-emitted word by word from `parseLine`. A word that passes the safe-word grammar and
    names no value (a command word, an option, a path inside the checkout, a revision) is kept; every other word,
    quoted string, option value, URL and here-document body becomes `<v>`.
  - `Edit`, `Write`, `Read`, `Agent`: only the normalised `file_path` (or the subagent type), a size bucket
    (`<1k`, `<100k`, `≥100k`) and the gate pattern that matched. Never file content, `old_string`/`new_string` or a
    prompt.
  - Normalised everywhere, `f0.reason` included: the repository's absolute path → `<repo>`, home directories
    (`/Users/*`, `/home/*`) → `~`, the scratchpad → `<scratchpad>`, session ids, UUIDs, IP addresses and long hex or
    base64 runs → `<v>`. An entry whose reason still holds a word outside the grammar is dropped.
  - Revisions and branch names are kept only when they pass the same safe-word grammar; otherwise `<v>`.
  - A unit test asserts every string in the fixture matches the allowed character classes and holds no home path,
    e-mail address, host other than `github.com`/`localhost`, or run of 20 or more hex/base64 characters.
  - The extractor prints how many entries it dropped per category; GPR-24's coverage floor is asserted on the kept
    entries, so a drop cannot lower coverage silently.
  - The fixture's commit is reviewed by the `security-reviewer` on the feature's diff before the merge, and is listed
    in the phase review for the maintainer.
- `scripts/test/gate-replay.test.mjs`: the category → expected decision table of GPR-26, the coverage assertions of
  GPR-23 and GPR-24, and one `decide` per entry with a fake `ctx` (`git`, `stat`, `readFile`, `realpath` answered
  from a fixture table), so it is a unit test. One more test runs the old rules and the new parser on the corpus and
  asserts the new parser never yields `allow` where an old deny or ask fires (GPR-04).
- `scripts/gate-bench.mjs`: spawns `node .claude/hooks/gate.mjs` per entry, prints p50 and p95, exits 1 above 300 ms.
  A unit test counts `git` spawns per line against the cap.
- **Not mutation proofs** (ADR 026): the GPR-21 test that spawns the gate per tool kind, `gate-bench.mjs` and the
  acceptance steps. `mutations.json` names only per-module `node --test` files under `.claude/hooks/test/` and
  `scripts/test/` that spawn nothing.

## Data Models

```ts
type Word = { text: string; quoted: 'none' | 'single' | 'double'; expands: boolean };
type Redirection = { op: '>' | '>>' | '&>' | '>|' | '>&' | '<' | '<<' | '<<<'; fd?: number; target: string };
type Segment = { words: Word[]; redirections: Redirection[] };

type ReplayEntry = {
  id: string; // stable, e.g. "ro-0042"
  category: string; // a key of the test's table
  tool: 'Bash' | 'Edit' | 'Write' | 'Read' | 'Agent';
  input:
    | { command: string } // Bash, re-emitted with <v> placeholders
    | { file_path?: string; subagent_type?: string; size: '<1k' | '<100k' | '≥100k'; pattern?: string };
  f0: { decision: 'ask' | 'deny' | 'prompt'; reason?: string }; // reason normalised like the command
};
```

## Error Handling Strategy

| Error Scenario                                                | Handling                                                                              | User Impact                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| Unparsable line                                               | `unsafe: ['unparsed']`, so no `allow`; old rules still run                            | Today's decision                  |
| Script unreadable or not text                                 | `ask` (GPR-12)                                                                        | A prompt, as today                |
| History store locked or corrupt                               | Treat as empty for the decision, move the corrupt file to `history.json.corrupt`, log | No polling deny for that call     |
| Input over 100 MB or content over 10 MB for a content rule    | `ask` (before any path rule for the 100 MB case; a test pins it)                      | A prompt instead of a hook error  |
| Malformed JSON on stdin, or `decide({})`                      | `ask`; `decide({})` has an explicit path and a test, never `allow`                    | A prompt                          |
| `cwd` missing, outside the checkout or in a nested repository | No `allow`; every other rule runs                                                     | Today's decision                  |
| A cap exceeded or a `git` spawn timed out                     | No `allow`                                                                            | Today's decision                  |
| The 5 s I/O deadline passed                                   | No `allow`; `ask` when a deny rule still needed the I/O                               | Today's decision or a prompt      |
| The gate still running at 8 s (stdin or `import()`)           | Watchdog answers `ask`                                                                | A prompt instead of a silent pass |
| A lazy `import()` fails                                       | `ask`                                                                                 | A prompt                          |
| Any exception in `decide`                                     | `ask` with the error (today's fail-closed path)                                       | A prompt                          |

## Risks & Concerns

| Risk                                                                            | Mitigation                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tokenizer accepts a shape bash reads differently                            | Fail closed on anything outside the grammar; the scenario and unit cases of GPR-03; the replay corpus                                                                   |
| `budget-v2` edits `budget-rules.mjs` in parallel                                | One small exemption here; the second merge resolves the conflict and reruns both rows' tests                                                                            |
| The corpus holds something private                                              | Allow-list extraction (AD-159), no file content or prompts, the fixture's character-class test, the secret scan, and the security review of the diff                    |
| A slow line outlives the hook timeout, which lets the call run                  | 8 s watchdog answering `ask`; caps on words, operands and spawns; spawn-free deny scans first                                                                           |
| Operands resolved against the wrong directory                                   | Everything resolves against `input.cwd` (or the `cd` target), which must sit inside the checkout and outside a nested repository                                        |
| A hard link gives a secret a harmless name                                      | `nlink` 1 required on the resolved target (a test pins it); ignored paths never allowed; the secret-name list stays the main defence for a file git does not ignore     |
| `..` or `./` in an operand escapes the checkout                                 | Operands are normalised before the inside-checkout check; a test pins it                                                                                                |
| `@d2rmm/x$(…)` or `@d2rmm/x/../ledger` passing as a package                     | Both stay ledger references; a test pins them                                                                                                                           |
| Lazy loading misses a module a rule needs                                       | GPR-21's test spawns the gate per tool kind and checks each rule still decides                                                                                          |
| `git` spawns push the p95 over 300 ms                                           | 8 spawns per line at most, `check-ignore` batched, a unit test on the spawn count, the bench as a `## Checks` proof                                                     |
| Aliases or functions shadowing `cat` or `git`, `CDPATH`                         | Come from the maintainer's shell, not the agent; accepted                                                                                                               |
| `git log -p`/`git show` with no path print unpushed commits and stashes too     | Accepted with AD-164; the history is not guaranteed to be pushed                                                                                                        |
| Polling through `command sleep`, `env sleep`, `timeout`, `watch`, `xargs sleep` | `sleepSeconds` reads the command word after `command`, `env`, `timeout N`, `xargs` and `\`; `watch`, and `until`/`while` with a `sleep` anywhere inside, count as loops |
| `gh pr view <url>` reaching another host                                        | `gh` positionals limited to digits or branch-like names with no `:` or `//`                                                                                             |

## Tech Decisions (only non-obvious ones)

| Decision                      | Choice                                      | Rationale                                                         |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Keep `decide` synchronous     | Load modules in `gate.mjs` and pass them in | Every existing test calls `decide` synchronously                  |
| A store apart from the ledger | `history.json`                              | Keeps clear of `budget-v2`'s ledger changes; hashes only (AD-158) |
| Read-only `allow` last        | After every deny and ask                    | GPR-04 by construction                                            |

## Requirement Coverage

| Requirement                      | Component                                                                                                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPR-01 to GPR-04, GPR-30, GPR-31 | `read-only.mjs`, `shell-parse.mjs`, the order of `checkBash`                                                                                                                                                                                                           |
| GPR-33                           | `LEDGER_REF` in `budget-rules.mjs`: `@d2rmm/<package-name>` followed by a space, a quote or the end of the word is not a ledger reference; every other form still is. Added as a new, separately tested function, a few lines, because `budget-v2` edits the same file |
| GPR-05 to GPR-10                 | `writes.mjs`, `checkInlineCode`, `checkScript`; `ln`, `install` and `cp` with a secret source join the secret-copy rule                                                                                                                                                |
| GPR-11 to GPR-13, GPR-32         | Scripts in `gate-rules.mjs`; the bare-word rule of `read-only.mjs`                                                                                                                                                                                                     |
| GPR-14                           | `runsSensor` exemption in `budget-rules.mjs`                                                                                                                                                                                                                           |
| GPR-15 to GPR-18                 | `polling.mjs`, `history-store.mjs`                                                                                                                                                                                                                                     |
| GPR-19                           | `.claude/agents/feature-worker.md`, phase-runner `SKILL.md`                                                                                                                                                                                                            |
| GPR-20, GPR-21                   | `gate.mjs` start-up                                                                                                                                                                                                                                                    |
| GPR-22                           | `scripts/gate-bench.mjs`                                                                                                                                                                                                                                               |
| GPR-23 to GPR-26                 | extractor, corpus, `gate-replay.test.mjs`                                                                                                                                                                                                                              |
| GPR-27 to GPR-29                 | the whole suite and the `@HBS-` scenarios                                                                                                                                                                                                                              |

## Test Strategy

- Unit (`node --test`, colocated under `.claude/hooks/test/` and `scripts/test/`): one file per new module; the
  read-only table proved row by row with allowed and refused options; writes, sleeps and repetition with a fake clock.
- Replay: `scripts/test/gate-replay.test.mjs` in `pnpm test:harness`.
- Acceptance: `tests/acceptance/steps/gate-precision.steps.ts`, reusing the gate step of `harness-bootstrap`.
- Benchmark: `node scripts/gate-bench.mjs`, a `## Checks` proof run on the phase machine.
- Mutation: on the pure modules' unit tests only (ADR 026).
