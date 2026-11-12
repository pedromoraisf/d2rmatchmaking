# ADR 031 — Workers on Sonnet by default; the maintainer switches the model in chat

**Status**: Accepted
**Date**: 2026-11-12 (accepted 2026-11-12 by the maintainer: "por padrão pode deixar assim, mas habilite para o padrão
esperado na janela de conversa com o agente ser eu falar pra mudar para outro que eu quiser a qualquer momento")
**Deciders**: maintainer
**Supersedes**: the implementer pin of ADR 025 (Haiku) and closes hypothesis H-001 of ADR 029

## Context

ADR 025 pinned `feature-worker` to Haiku, and ADR 029 kept it as hypothesis H-001: try Sonnet workers if Haiku kept
needing many fix rounds. The F1 review (`.specs/phases/F1/review.md`, "H-001 reading") measured it. Haiku workers
needed 3–9 fix rounds per feature and stalled twice (ready-check T10, characters-reading Batch 5). Sonnet workers
needed 1–4 rounds from ready-check on, and passed both stuck units on their first try.

## Decision

- `feature-worker` runs on **Sonnet** by default (`.claude/agents/feature-worker.md`, `model: sonnet`).
- **The maintainer can change the worker model at any time, in the conversation** ("workers on Haiku", "use Opus for
  this feature", "back to the default"). The orchestrator passes that model as the dispatch's `model` override from
  then on, until the maintainer changes it again or the session ends. It writes one line in the phase's `decisions.md`
  with the maintainer's words, so the fix-round numbers stay readable. No ADR or file edit is needed for a switch.
- The orchestrator never changes the worker model on its own judgement. It may propose a switch in chat, with the
  fix-round evidence, and waits for the maintainer's words.
- Reviewers stay on Sonnet and the orchestrator on Opus (ADR 025 unchanged there). Fix rounds stay in every PR
  description, so the next phase review can compare models.

## Alternatives considered

- Keep Haiku and switch per feature only: F1 showed the stalls cost more orchestrator time than the cheaper tokens
  saved.
- A model field per feature in the brief: more ceremony than a sentence in chat (memory: autonomy over ceremony).

## Consequences

- Each worker dispatch costs more than on Haiku. The maintainer can trade that back at any time with one sentence.
- `AGENTS.md`, `CLAUDE.md` and the phase-runner skill name Sonnet as the default and point here for the switch.
