@AGENTS.md

## Claude Code specifics

- Hooks (`.claude/settings.json`): **gate** (PreToolUse) denies or escalates risky calls; **feedback** (PostToolUse)
  runs prettier, ESLint, dependency-cruiser, related tests and TLC validators on the file you edited; **stop** runs
  affected type checks and tests before you end a turn. When a hook reports errors, fix them — do not work around it.
- Skills: `tlc-spec-driven` (the method, vendored) and `d2rmm-phase-runner` (this project's automated per-phase loop).
  Start any feature work from `/phase-run`, not from a bare prompt.
- Roles and models (ADR 025): this session is the **orchestrator** — Opus 5.5 at medium effort, pinned in
  `.claude/settings.json` — and plans, gates and integrates; it never writes feature code. `feature-worker` subagents
  (**Haiku**) implement task batches in parallel worktrees; `spec-reviewer`, `architecture-reviewer`,
  `security-reviewer` and `verifier` (**Sonnet**) judge. The gate enforces the mapping and refuses model overrides.
- Commands: `/phase-kickoff`, `/phase-run`, `/phase-review`, `/check`, `/adr`.
- Retry budget (ADR 022): 1 attempt + 2 retries per unit. The hooks count gates, dispatches, red stops, repeated sensor
  failures and repeated denials in `.git/d2rmm/ledger.json`; when one is exhausted, record the blocker and report.
- Resume: run `pnpm phase:status` first; it is the only source of "what's next" (ADR 024).
- Escalations come to the maintainer as a permission prompt ("ask"). Everything else is recorded for the phase review.
