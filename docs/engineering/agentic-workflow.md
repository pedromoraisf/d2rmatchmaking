# Agentic workflow (how the harness fits together)

Lean harness, ADR 029: CI is the quality gate; the hooks only guard what cannot be undone.

```text
GUIDES (feed-forward)                 SENSORS (feedback)                         GATES (stop)
AGENTS.md, CLAUDE.md                  PostToolUse: prettier, eslint,             PreToolUse gate: deny/ask on the
docs/engineering/lessons.md             depcruise, vitest related, own test        few irreversible actions
.cursor/rules/*.mdc (scoped)          Stop hook: affected types/tests            CI: verify, integration, agent, secrets
docs/domain, docs/adr, .specs         Lefthook pre-commit / pre-push             phase brief and review (maintainer)
skill: d2rmm-phase-runner             quality ratchet (.quality-baseline.json)
subagents: feature-worker, reviewers  nightly: mutation, ratchet, backup
```

- Method: `d2rmm-phase-runner` (`.claude/skills/d2rmm-phase-runner/SKILL.md`). Per feature: spec with Gherkin
  scenarios, design only when Large or Complex, a task checklist, one PR into the phase branch merged when CI is green.
- Human touchpoints per phase: **kickoff** (approve the brief) and **review** (approve `review.md`), plus escalations.
- Failures: fix the cause and rerun; after three failures of the same thing, record the blocker and move on. Lessons go
  to `docs/engineering/lessons.md`, which every agent reads first.
- Mutation testing runs in the nightly only (ADR 026, ADR 029).
- `pnpm test:harness` tests the gate rules, the feedback plan, the phase state, the ratchet and the workflow files.
- `pnpm harness` prints the harness-score report; it is not a gate.
