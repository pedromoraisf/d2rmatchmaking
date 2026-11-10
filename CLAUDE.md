@AGENTS.md

## Claude Code specifics

- Hooks (`.claude/settings.json`): **gate** (PreToolUse) denies or asks on the few irreversible or maintainer-owned
  actions (ADR 029); **feedback** (PostToolUse) runs prettier, ESLint, dependency-cruiser, related tests and the edited
  file's own harness test; **stop** runs affected type checks and tests before you end a turn and blocks once if they
  are red. When a hook reports errors, fix them — do not work around it.
- Skill: `d2rmm-phase-runner` (this project's per-phase loop). Start feature work from `/phase-run`, not from a bare
  prompt. Read `docs/engineering/lessons.md` first.
- Roles and models (ADR 025): this session is the **orchestrator** — Opus 5.5 at medium effort, pinned in
  `.claude/settings.json` — and plans, reviews and integrates; it never writes feature code. `feature-worker` subagents
  (**Haiku**) implement task batches in their own worktrees (`isolation: "worktree"`); `architecture-reviewer` and
  `security-reviewer` (**Sonnet**) review each feature PR once. Hypothesis H-001: Sonnet workers, if Haiku keeps needing
  many fix rounds.
- Commands: `/phase-kickoff`, `/phase-run`, `/phase-review`, `/check`, `/adr`.
- Failures: fix the cause and rerun; after three failures of the same thing, record the blocker and move on (rule 11).
- Resume: run `pnpm phase:status` first; it is the only source of "what's next".
- Escalations come to the maintainer as a permission prompt ("ask") or one precise question. Push, PRs, merges,
  releases and tags are the runner's (ADR 028 § 1); secrets, repository settings and money still ask.
