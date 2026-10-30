# Agentic workflow (how the harness fits together)

```text
GUIDES (feed-forward)                 SENSORS (feedback)                         GATES (stop)
AGENTS.md, CLAUDE.md                  PostToolUse: prettier, eslint,             PreToolUse gate: deny/ask
.cursor/rules/*.mdc (scoped)            depcruise, vitest related, TLC validators  Stop hook: affected types/tests
docs/domain, docs/engineering         Lefthook pre-commit / pre-push             CI: verify, integration, agent, secrets
docs/adr, .specs (TLC)                CI + nightly (mutation, harness report)    harness-score --min-level 4
skills: tlc-spec-driven,              quality ratchet (.quality-baseline.json)   phase review (maintainer)
  d2rmm-phase-runner
subagents: reviewers, verifier, worker
```

- Method: TLC spec-driven (`.claude/skills/tlc-spec-driven`), wrapped by `d2rmm-phase-runner` (ADR 021).
- Human touchpoints per phase: **kickoff** (approve brief + delegation) and **review** (`review.md`), plus escalations.
- The harness is code: `pnpm test:harness` tests the gate rules, the feedback plan, the ratchet and the delegation checks.
- Retry budget (ADR 022): 1 attempt + 2 retries per unit of work, counted in `.git/d2rmm/ledger.json` by the hooks and
  `scripts/attempt.mjs`; exhausted units block instead of looping.
- Harness maturity is measured by `harness-score` and must stay at L4; its score is part of the ratchet.
